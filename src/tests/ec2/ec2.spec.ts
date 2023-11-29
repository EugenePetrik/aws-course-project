import { expect } from 'chai';
import axios from 'axios';
import { EC2Client, DescribeInstancesCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { BaseConfig } from '../../BaseConfig';

describe('EC2', () => {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  let publicIpv4Address: string = null;
  let privateIpv4Address: string = null;

  let ec2: EC2Client = null;
  let deployedInstances: any[] = null;

  before(async () => {
    // Configure AWS SDK
    ec2 = new EC2Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Get information about instances
    const params = {
      Filters: [
        {
          Name: 'instance-state-name',
          Values: ['running'],
        },
      ],
    };

    const data = await ec2.send(new DescribeInstancesCommand(params));

    // Extract relevant information about the instances
    deployedInstances = data.Reservations.reduce((acc, reservation) => {
      return acc.concat(
        reservation.Instances.map((instance) => ({
          id: instance.InstanceId,
          type: instance.PublicIpAddress ? 'public' : 'private',
          instanceType: instance.InstanceType,
          tags: instance.Tags,
          rootBlockDeviceSize: instance.BlockDeviceMappings[0]?.Ebs,
          os: instance,
        })),
      );
    }, []);
  });

  it('Two application instances should be deployed (public and private)', () => {
    expect(deployedInstances).to.have.length(2);

    // Check public instance
    const publicInstance = deployedInstances.find((instance) => instance.type === 'public');

    expect(publicInstance.type).to.equal('public');
    expect(publicInstance.instanceType).to.equal('t2.micro');
    expect(publicInstance.tags.find((tag) => tag.Key === 'Name').Value).to.equal('cloudxinfo/PublicInstance/Instance');
    expect(publicInstance.tags.find((tag) => tag.Key === 'cloudx').Value).to.equal('qa');
    expect(publicInstance.os.PlatformDetails).to.equal('Linux/UNIX');
    expect(publicInstance.os.PublicIpAddress).to.exist.and.not.be.empty;

    // Check private instance
    const privateInstance = deployedInstances.find((instance) => instance.type === 'private');

    expect(privateInstance.type).to.equal('private');
    expect(privateInstance.instanceType).to.equal('t2.micro');
    expect(privateInstance.tags.find((tag) => tag.Key === 'Name').Value).to.equal(
      'cloudxinfo/PrivateInstance/Instance',
    );
    expect(privateInstance.tags.find((tag) => tag.Key === 'cloudx').Value).to.equal('qa');
    expect(privateInstance.os.PlatformDetails).to.equal('Linux/UNIX');
    expect(privateInstance.os?.PublicIpAddress).to.be.undefined;
    expect(privateInstance.os.PrivateIpAddress).to.exist.and.not.be.empty;

    publicIpv4Address = publicInstance.os.PublicIpAddress;
    privateIpv4Address = publicInstance.os.PrivateIpAddress;
  });

  it(`Should have security groups' configuration`, async () => {
    // Get the security group IDs associated with the public instance
    const publicInstance = deployedInstances.find((instance) => instance.type === 'public');
    const publicSecurityGroupIds = publicInstance.os.SecurityGroups.map((group) => group.GroupId);

    // Describe security groups for the public instance
    const publicSecurityGroups = await ec2.send(
      new DescribeSecurityGroupsCommand({
        GroupIds: publicSecurityGroupIds,
      }),
    );

    // Assertions for public instance security group
    const publicSecurityGroup = publicSecurityGroups.SecurityGroups[0];

    expect(publicSecurityGroup.IpPermissions).to.deep.include({
      FromPort: 80,
      IpProtocol: 'tcp',
      IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP from Internet' }],
      Ipv6Ranges: [],
      PrefixListIds: [],
      ToPort: 80,
      UserIdGroupPairs: [],
    });

    expect(publicSecurityGroup.IpPermissions).to.deep.include({
      FromPort: 22,
      IpProtocol: 'tcp',
      IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH from Internet' }],
      Ipv6Ranges: [],
      PrefixListIds: [],
      ToPort: 22,
      UserIdGroupPairs: [],
    });

    const groupId: string = publicSecurityGroup.GroupId;
    const ownerId: string = publicSecurityGroup.OwnerId;

    // Get the security group IDs associated with the private instance
    const privateInstance = deployedInstances.find((instance) => instance.type === 'private');
    const privateSecurityGroupIds = privateInstance.os.SecurityGroups.map((group) => group.GroupId);

    // Describe security groups for the private instance
    const privateSecurityGroups = await ec2.send(
      new DescribeSecurityGroupsCommand({
        GroupIds: privateSecurityGroupIds,
      }),
    );

    // Assertions for private instance security group
    const privateSecurityGroup = privateSecurityGroups.SecurityGroups[0];

    expect(privateSecurityGroup.IpPermissions).to.deep.include({
      FromPort: 80,
      IpProtocol: 'tcp',
      IpRanges: [],
      Ipv6Ranges: [],
      PrefixListIds: [],
      ToPort: 80,
      UserIdGroupPairs: [{ Description: 'HTTP from Internet', GroupId: groupId, UserId: ownerId }],
    });

    expect(privateSecurityGroup.IpPermissions).to.deep.include({
      FromPort: 22,
      IpProtocol: 'tcp',
      IpRanges: [],
      Ipv6Ranges: [],
      PrefixListIds: [],
      ToPort: 22,
      UserIdGroupPairs: [{ Description: 'SSH from Internet', GroupId: groupId, UserId: ownerId }],
    });
  });

  it('Application API endpoint should respond with the correct instance information from EC2 metadata', async () => {
    const response = await axios.get(`http://${publicIpv4Address}`);

    expect(response.status).to.equal(200);

    expect(response.data.availability_zone).to.equal('us-east-1a');
    expect(response.data.private_ipv4).to.equal(privateIpv4Address);
    expect(response.data.region).to.equal('us-east-1');
  });
});
