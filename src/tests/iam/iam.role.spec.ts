import { expect } from 'chai';
import { IAMClient, GetRoleCommand, ListAttachedRolePoliciesCommand } from '@aws-sdk/client-iam';
import { BaseConfig } from '../../BaseConfig';

describe('IAM Roles', () => {
  [
    {
      skip: false,
      title: 'Should have FullAccessRoleEC2 created with FullAccessPolicyEC2 permission policy',
      roleName: 'FullAccessRoleEC2',
      policyName: 'FullAccessPolicyEC2',
      expectedRole: [
        {
          Effect: 'Allow',
          Principal: { Service: 'ec2.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    },
    {
      skip: false,
      title: 'Should have FullAccessRoleS3 created with FullAccessPolicyS3 permission policy',
      roleName: 'FullAccessRoleS3',
      policyName: 'FullAccessPolicyS3',
      expectedRole: [
        {
          Effect: 'Allow',
          Principal: { Service: 'ec2.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    },
    {
      skip: false,
      title: 'Should have ReadAccessRoleS3 created with ReadAccessPolicyS3 permission policy',
      roleName: 'ReadAccessRoleS3',
      policyName: 'ReadAccessPolicyS3',
      expectedRole: [
        {
          Effect: 'Allow',
          Principal: { Service: 'ec2.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    },
  ].forEach(({ skip, title, roleName, policyName, expectedRole }) => {
    (skip ? it.skip : it)(title, async () => {
      const { accountId, accessKeyId, secretAccessKey, region } = BaseConfig;

      const credentials = { accessKeyId, secretAccessKey, region };

      const iam = new IAMClient(credentials);

      // Get the role
      const role = await iam.send(
        new GetRoleCommand({
          RoleName: roleName,
        }),
      );

      // Validate the role data
      expect(role.Role.RoleName).to.equal(roleName);
      expect(role.Role.Arn).to.equal(`arn:aws:iam::${accountId}:role/${roleName}`);

      // Decode the URL-encoded JSON document
      const decodedDocument = decodeURIComponent(role.Role?.AssumeRolePolicyDocument);

      // Parse the JSON document to access the statements
      const statements = JSON.parse(decodedDocument).Statement;

      // Validate the role
      expect(statements).to.eql(expectedRole);

      // Get the attached policies for the role
      const attachedPolicies = await iam.send(
        new ListAttachedRolePoliciesCommand({
          RoleName: roleName,
        }),
      );

      const policies = attachedPolicies.AttachedPolicies;

      // Validate the policy data
      const expectedPolicies = [
        {
          PolicyArn: `arn:aws:iam::${accountId}:policy/${policyName}`,
          PolicyName: policyName,
        },
      ];

      expect(policies).to.eql(expectedPolicies);
    });
  });
});
