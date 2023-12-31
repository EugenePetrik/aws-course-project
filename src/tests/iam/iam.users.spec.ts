import { expect } from 'chai';
import {
  IAMClient,
  ListGroupsForUserCommand,
  GetUserCommand,
  GetUserCommandOutput,
  ListGroupsForUserCommandOutput,
  Group,
} from '@aws-sdk/client-iam';
import { BaseConfig } from '../../BaseConfig';

describe('IAM Users', () => {
  [
    {
      skip: false,
      title: 'Should have FullAccessUserEC2 created with FullAccessGroupEC2 user group membership',
      userName: 'FullAccessUserEC2',
      groupName: 'FullAccessGroupEC2',
    },
    {
      skip: false,
      title: 'Should have FullAccessUserS3 created with FullAccessGroupS3 user group membership',
      userName: 'FullAccessUserS3',
      groupName: 'FullAccessGroupS3',
    },
    {
      skip: false,
      title: 'Should have ReadAccessUserS3 created with ReadAccessGroupS3 user group membership',
      userName: 'ReadAccessUserS3',
      groupName: 'ReadAccessGroupS3',
    },
  ].forEach(({ skip, title, userName, groupName }) => {
    (skip ? it.skip : it)(title, async () => {
      const { accountId, accessKeyId, secretAccessKey, region } = BaseConfig;

      const credentials = { accessKeyId, secretAccessKey, region };

      const iam: IAMClient = new IAMClient(credentials);

      // Get the user
      const user: GetUserCommandOutput = await iam.send(new GetUserCommand({ UserName: userName }));

      // Validate the user data
      expect(user.User.UserName, 'User.UserName is not correct').to.equal(userName);
      expect(user.User.Arn, 'User.Arn is not correct').to.equal(`arn:aws:iam::${accountId}:user/${userName}`);

      // Check if the user is a member of the specified group
      const groupsForUser: ListGroupsForUserCommandOutput = await iam.send(
        new ListGroupsForUserCommand({
          UserName: userName,
        }),
      );

      // Extract groups from the response
      const groupNamesForUser: Group = groupsForUser.Groups.find((group) => group.GroupName === groupName);

      expect(groupNamesForUser.GroupName, 'User group GroupName is not correct').to.equal(groupName);
      expect(groupNamesForUser.Arn, 'User group Arn is not correct').to.equal(
        `arn:aws:iam::${accountId}:group/${groupName}`,
      );
    });
  });
});
