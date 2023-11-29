import { expect } from 'chai';
import { IAMClient, GetPolicyCommand, GetPolicyVersionCommand } from '@aws-sdk/client-iam';
import { BaseConfig } from '../../BaseConfig';

describe('IAM Policies', () => {
  [
    {
      skip: false,
      title: 'Should have FullAccessPolicyEC2 created',
      policyName: 'FullAccessPolicyEC2',
      expectedPolicy: [
        {
          Action: 'ec2:*',
          Effect: 'Allow',
          Resource: '*',
        },
      ],
    },
    {
      skip: false,
      title: 'Should have FullAccessPolicyS3 created',
      policyName: 'FullAccessPolicyS3',
      expectedPolicy: [
        {
          Action: 's3:*',
          Effect: 'Allow',
          Resource: '*',
        },
      ],
    },
    {
      skip: false,
      title: 'Should have ReadAccessPolicyS3 created',
      policyName: 'ReadAccessPolicyS3',
      expectedPolicy: [
        {
          Action: ['s3:Describe*', 's3:Get*', 's3:List*'],
          Effect: 'Allow',
          Resource: '*',
        },
      ],
    },
  ].forEach(({ skip, title, policyName, expectedPolicy }) => {
    (skip ? it.skip : it)(title, async () => {
      const { accountId, accessKeyId, secretAccessKey, region } = BaseConfig;

      const credentials = { accessKeyId, secretAccessKey, region };

      const POLICY_ARN = `arn:aws:iam::${accountId}:policy/${policyName}`;

      const iam = new IAMClient(credentials);

      // Get the policy
      const policy = await iam.send(
        new GetPolicyCommand({
          PolicyArn: POLICY_ARN,
        }),
      );

      // Get the default policy version
      const defaultVersionId = policy.Policy?.DefaultVersionId;

      // Get the policy version
      const policyVersion = await iam.send(
        new GetPolicyVersionCommand({
          PolicyArn: POLICY_ARN,
          VersionId: defaultVersionId,
        }),
      );

      // Decode the URL-encoded JSON document
      const decodedDocument = decodeURIComponent(policyVersion.PolicyVersion.Document);

      // Parse the JSON document to access the statements
      const actualPolicy = JSON.parse(decodedDocument).Statement;

      // Validate the policy data
      expect(
        actualPolicy,
        `Policy is not correct: actual policy - ${JSON.stringify(actualPolicy)}, expected policy - ${JSON.stringify(
          expectedPolicy,
        )}`,
      ).to.eql(expectedPolicy);
    });
  });
});
