#!/usr/bin/env node

import * as cdk from "aws-cdk-lib";
import {SecurePaymentStack} from "../lib/secure-payments-stack";

const app  = new cdk.App();

new SecurePaymentStack(app, "SecurePaymentStack", {

    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    }
});