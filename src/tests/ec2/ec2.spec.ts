import { expect } from 'chai';
import axios from 'axios';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeVolumesCommand,
} from '@aws-sdk/client-ec2';
import { BaseConfig } from '../../BaseConfig';

describe('EC2', () => {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

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

  it('Should create two application instances', () => {
    expect(deployedInstances, 'The number of deployed instances is not correct').to.have.length(2);
  });

  it('Should return public instance configuration', () => {
    const publicInstance = deployedInstances.find((instance) => instance.type === 'public');

    expect(publicInstance.type, 'Type of instance is not correct').to.equal('public');
    expect(publicInstance.instanceType, 'Instance type is not correct').to.equal('t2.micro');
    expect(publicInstance.tags.find((tag) => tag.Key === 'Name').Value, `Tag 'Name' is not correct`).to.equal(
      'cloudxinfo/PublicInstance/Instance',
    );
    expect(publicInstance.tags.find((tag) => tag.Key === 'cloudx').Value, `Tag 'cloudx' is not correct`).to.equal('qa');
    expect(publicInstance.os.PlatformDetails, `'os.PlatformDetails' is not correct`).to.equal('Linux/UNIX');
    expect(publicInstance.os.PublicIpAddress, `'os.PublicIpAddress' is not correct`).to.exist.and.not.be.empty;
  });

  it('Should return private instance configuration', () => {
    const privateInstance = deployedInstances.find((instance) => instance.type === 'private');

    expect(privateInstance.type, 'Type of instance is not correct').to.equal('private');
    expect(privateInstance.instanceType, 'Instance type is not correct').to.equal('t2.micro');
    expect(privateInstance.tags.find((tag) => tag.Key === 'Name').Value, `Tag 'Name' is not correct`).to.equal(
      'cloudxinfo/PrivateInstance/Instance',
    );
    expect(privateInstance.tags.find((tag) => tag.Key === 'cloudx').Value, `Tag 'cloudx' is not correct`).to.equal(
      'qa',
    );
    expect(privateInstance.os.PlatformDetails, `'os.PlatformDetails' is not correct`).to.equal('Linux/UNIX');
    expect(privateInstance.os?.PublicIpAddress, `'os.PublicIpAddress' is not correct`).to.be.undefined;
    expect(privateInstance.os.PrivateIpAddress, `'os.PrivateIpAddress' is not correct`).to.exist.and.not.be.empty;
  });

  it('Should return public instances volumes', async () => {
    const instanceId = deployedInstances.find((instance) => instance.type === 'public').id;

    const params = {
      Filters: [
        {
          Name: 'attachment.instance-id',
          Values: [instanceId],
        },
      ],
    };

    const data = await ec2.send(new DescribeVolumesCommand(params));

    expect(data.Volumes[0].Size, `'Volumes.Size' is not correct`).to.equal(8);
    expect(data.Volumes[0].VolumeType, `'Volumes.VolumeType' is not correct`).to.equal('gp2');
  });

  it('Should return private instances volumes', async () => {
    const instanceId = deployedInstances.find((instance) => instance.type === 'private').id;

    const params = {
      Filters: [
        {
          Name: 'attachment.instance-id',
          Values: [instanceId],
        },
      ],
    };

    const data = await ec2.send(new DescribeVolumesCommand(params));

    expect(data.Volumes[0].Size, `'Volumes.Size' is not correct`).to.equal(8);
    expect(data.Volumes[0].VolumeType, `'Volumes.VolumeType' is not correct`).to.equal('gp2');
  });

  it(`Should return security groups configuration for the instances`, async () => {
    // Get the security group IDs associated with the public instance
    const publicSecurityGroupIds = deployedInstances
      .find((instance) => instance.type === 'public')
      .os.SecurityGroups.map((group) => group.GroupId);

    // Describe security groups for the public instance
    const publicSecurityGroups = await ec2.send(
      new DescribeSecurityGroupsCommand({
        GroupIds: publicSecurityGroupIds,
      }),
    );

    const publicSecurityGroup = publicSecurityGroups.SecurityGroups[0];

    expect(
      publicSecurityGroup.IpPermissions,
      `Public Security Group IpPermissions for port 80 are not correct`,
    ).to.deep.include({
      FromPort: 80,
      IpProtocol: 'tcp',
      IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP from Internet' }],
      Ipv6Ranges: [],
      PrefixListIds: [],
      ToPort: 80,
      UserIdGroupPairs: [],
    });

    expect(
      publicSecurityGroup.IpPermissions,
      `Public Security Group IpPermissions for port 22 are not correct`,
    ).to.deep.include({
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
    const privateSecurityGroupIds = deployedInstances
      .find((instance) => instance.type === 'private')
      .os.SecurityGroups.map((group) => group.GroupId);

    // Describe security groups for the private instance
    const privateSecurityGroups = await ec2.send(
      new DescribeSecurityGroupsCommand({
        GroupIds: privateSecurityGroupIds,
      }),
    );

    const privateSecurityGroup = privateSecurityGroups.SecurityGroups[0];

    expect(
      privateSecurityGroup.IpPermissions,
      `Private Security Group IpPermissions for port 80 are not correct`,
    ).to.deep.include({
      FromPort: 80,
      IpProtocol: 'tcp',
      IpRanges: [],
      Ipv6Ranges: [],
      PrefixListIds: [],
      ToPort: 80,
      UserIdGroupPairs: [{ Description: 'HTTP from Internet', GroupId: groupId, UserId: ownerId }],
    });

    expect(
      privateSecurityGroup.IpPermissions,
      `Private Security Group IpPermissions for port 22 are not correct`,
    ).to.deep.include({
      FromPort: 22,
      IpProtocol: 'tcp',
      IpRanges: [],
      Ipv6Ranges: [],
      PrefixListIds: [],
      ToPort: 22,
      UserIdGroupPairs: [{ Description: 'SSH from Internet', GroupId: groupId, UserId: ownerId }],
    });
  });

  it('Application API endpoint should return correct instance information', async () => {
    const publicInstance = deployedInstances.find((instance) => instance.type === 'public');

    const publicIpv4Address = publicInstance.os.PublicIpAddress;
    const privateIpv4Address = publicInstance.os.PrivateIpAddress;

    const response = await axios.get(`http://${publicIpv4Address}`);

    expect(response.status, 'Response status is not correct').to.equal(200);

    expect(response.data.availability_zone, 'availability_zone is not correct').to.equal('us-east-1a');
    expect(response.data.private_ipv4, 'private_ipv4 is not correct').to.equal(privateIpv4Address);
    expect(response.data.region, 'region is not correct').to.equal('us-east-1');
  });
});
