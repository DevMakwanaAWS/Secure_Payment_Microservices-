import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import {Runtime, Tracing} from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export class SecurePaymentStack extends cdk.Stack{
    constructor(scope: Construct, id: string, props?: cdk.StackProps){
        super(scope, id, props);
    
        // Minimal health Lambda (bundles TypeScript from /service)
        const healthFn = new lambda.NodejsFunction(this, "HealthFunction", {
            entry: path.join(__dirname, "../../service/handlers/health.ts"),
            runtime: Runtime.NODEJS_22_X,
            tracing: Tracing.ACTIVE,
            memorySize: 256,
            timeout: cdk.Duration.seconds(5),
            bundling: {
                minify: true
            }
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

        const health = api.root.addResource("healthz");
        health.addMethod("GET", new apigw.LambdaIntegration(healthFn), {
            methodResponses: [{statusCode: "200"}]
        });

        new cdk.CfnOutput(this, "ApiBaseUrl", {value: api.url ?? ""});
        new cdk.CfnOutput(this, "HealthzUrl", {value: `${api.url}healthz`});
    }
}