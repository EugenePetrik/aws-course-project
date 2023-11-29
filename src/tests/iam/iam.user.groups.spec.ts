import { expect } from 'chai';
import { IAMClient, ListAttachedGroupPoliciesCommand, GetGroupCommand } from '@aws-sdk/client-iam';
import { BaseConfig } from '../../BaseConfig';

describe('IAM User Groups', () => {
  [
    {
      skip: false,
      title: 'Should have FullAccessGroupEC2 created with FullAccessPolicyEC2 permission policy',
      groupName: 'FullAccessGroupEC2',
      policyName: 'FullAccessPolicyEC2',
    },
    {
      skip: false,
      title: 'Should have FullAccessGroupS3 created with FullAccessPolicyS3 permission policy',
      groupName: 'FullAccessGroupS3',
      policyName: 'FullAccessPolicyS3',
    },
    {
      skip: false,
      title: 'Should have ReadAccessGroupS3 created with ReadAccessPolicyS3 permission policy',
      groupName: 'ReadAccessGroupS3',
      policyName: 'ReadAccessPolicyS3',
    },
  ].forEach(({ skip, title, groupName, policyName }) => {
    (skip ? it.skip : it)(title, async () => {
      const { accountId, accessKeyId, secretAccessKey, region } = BaseConfig;

      const credentials = { accessKeyId, secretAccessKey, region };

      const iam = new IAMClient(credentials);

      // Get the user group
      const group = await iam.send(new GetGroupCommand({ GroupName: groupName }));

      // Validate the group data
      expect(group.Group.GroupName, 'Group.GroupName is not correct').to.equal(groupName);
      expect(group.Group.Arn, 'Group.Arn is not correct').to.equal(`arn:aws:iam::${accountId}:group/${groupName}`);

      // Get the attached policies for the group
      const attachedPolicies = await iam.send(
        new ListAttachedGroupPoliciesCommand({
          GroupName: groupName,
        }),
      );

      // Extract policy names from the response
      const actualPolicy = attachedPolicies.AttachedPolicies.filter((policy) => policy.PolicyName === policyName);

      // Validate the policy data
      const expectedPolicy = [
        {
          PolicyName: policyName,
          PolicyArn: `arn:aws:iam::${accountId}:policy/${policyName}`,
        },
      ];

      expect(
        actualPolicy,
        `Policy is not correct: actual policy - ${JSON.stringify(actualPolicy)}, expected policy - ${JSON.stringify(
          expectedPolicy,
        )}`,
      ).to.eql(expectedPolicy);
    });
  });
});
