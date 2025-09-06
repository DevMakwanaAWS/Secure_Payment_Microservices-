import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";
import {Runtime, Tracing} from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export class SecurePaymentStack extends cdk.Stack{
    constructor(scope: Construct, id: string, props?: cdk.StackProps){
        super(scope, id, props);

        /** KMS: one CMK for DynamoDB SSE + app-level field encryption */
        const cmk = new kms.Key(this, "PaymentsKey", {
            alias: "alias/secure-payment-cmk",
            description: "CMK for DynamoDB SSE and application-level field encryption",
            enableKeyRotation: false
        });

        /** DynamoDB: single table, encrypted with our CMK, pay-per-request */
        const table = new ddb.Table(this, "PaymentsTable", {
            partitionKey: {name: "pk", type:ddb.AttributeType.STRING},
            sortKey: {name: "sk", type:ddb.AttributeType.STRING},
            billingMode: ddb.BillingMode.PAY_PER_REQUEST,
            encryption: ddb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: cmk,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        // GSI to list by status (simple, demo-friendly)
        table.addGlobalSecondaryIndex({
            indexName: 'gsi1',
            partitionKey: {name: "gsi1pk", type: ddb.AttributeType.STRING},
            sortKey: {name: "gsi1sk", type: ddb.AttributeType.STRING}
        });
        
         /** SSM Parameters: editable config at runtime (no code change) */
         new ssm.StringParameter(this, "MaskPattern", {
            parameterName: "secure-payments/config/MASK_PATTERN",
            stringValue: "****-****-####"
         });
         new ssm.StringParameter(this, "MazAmount", {
            parameterName: "secure-payment/config/MAX_AMOUNT",
            stringValue: "50000"
         });

        /** Shared Lambda env */
         const env = {
            TABLE_NAME: table.tableName,
            GSI1_NAME: "gsi1",
            KMS_KEY_ID: cmk.keyId,
            MASK_PARAM: "/secure-payments/config/MASK_PATTERN",
            MAX_AMOUTN_PARAM: "/secure-payments/config/MAX_AMOUNT"
         };

         /** Helper to make NodejsFunction with consistent settings */
         const mkFn = (id: string, entryRel: string) => 
            new lambda.NodejsFunction(this, id, {
                entry: path.join(__dirname, entryRel),
                runtime: Runtime.NODEJS_22_X,
                tracing: Tracing.ACTIVE,
                memorySize: 256,
                timeout: cdk.Duration.seconds(10),
                bundling: {minify: true},
                environment: env
            });


        // Lambdas
        const healthFn = mkFn("HealthFn", "../../service/handlers/health.ts");
        const createFn = mkFn("HealthFn", "../../service/handlers/createPayment.ts");
        const getFn = mkFn("HealthFn", "../../service/handlers/getPayment.ts");
        const listFn = mkFn("HealthFn", "../../service/handlers/listPayment.ts");
        const approveFn = mkFn("HealthFn", "../../service/handlers/approvePayment.ts");

         /** Least-privilege IAM grants */

         // DynamoDB
         table.grantReadWriteData(createFn);
         table.grantReadData(getFn);
         table.grantReadData(listFn);
         table.grantReadWriteData(approveFn);

         // KMS
         cmk.grantEncryptDecrypt(createFn);
         cmk.grantDecrypt(getFn);

         // SSM (only read these param paths)
         [createFn, getFn, listFn, approveFn].forEach(fn => {
            fn.addToRolePolicy(new iam.PolicyStatement({
                actions: ["ssm:GetParameter"],
                resources: [
                    `arn:aws:ssm:${this.region}:${this.account}:parameter/secure-payments/config/*`
                ]
            }));
         });

        // REST API (v1) with /healthz
        const api = new apigw.RestApi(this, "SecurePaymentApi", {
            deployOptions: {
                stageName: "dev",
                metricsEnabled: true,
                loggingLevel: apigw.MethodLoggingLevel.INFO,
                dataTraceEnabled: false
            }
        });


        // /healthz
        const health = api.root.addResource("healthz");
        health.addMethod("GET", new apigw.LambdaIntegration(healthFn), {
            methodResponses: [{statusCode: "200"}]
        });

        // /payments
        const payments = api.root.addResource("payments");
        payments.addMethod("POST", new apigw.LambdaIntegration(createFn));  // create
        payments.addMethod("GET", new apigw.LambdaIntegration(listFn));     // list

        // /payment/{paymentId}
        const byId = payments.addResource("{paymentId}");                   
        byId.addMethod("GET", new apigw.LambdaIntegration(getFn));          // get one                    

        // /payment/{paymentId}/approve
        byId.addResource("approve")
            .addMethod("POST", new apigw.LambdaIntegration(approveFn));     // approve

        /** Helpful outputs printed after deploy */
        new cdk.CfnOutput(this, "ApiBaseUrl", {value: api.url ?? ""});
        new cdk.CfnOutput(this, "HealthzUrl", {value: `${api.url}healthz`});
        new cdk.CfnOutput(this, "CreatePaymentUrl", { value: `${api.url}payments` });
    }
}