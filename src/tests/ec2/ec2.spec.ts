import { expect } from 'chai';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { BaseConfig } from '../../BaseConfig';

describe('EC2', () => {
  it('Two application instances should be deployed - public and private', async () => {
    const { accessKeyId, secretAccessKey, region } = BaseConfig;

    // Configure AWS SDK with your credentials and region
    const ec2 = new EC2Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Use DescribeInstancesCommand to get information about your instances
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
    const deployedInstances = data.Reservations.reduce((acc, reservation) => {
      return acc.concat(
        reservation.Instances.map((instance) => ({
          id: instance.InstanceId,
          type: instance.PublicIpAddress ? 'public' : 'private',
          // Add more details as needed
        })),
      );
    }, []);

    expect(deployedInstances).to.have.length(2);

    console.log('Deployed Instances:', deployedInstances);

    const publicInstances = deployedInstances.filter((instance) => instance.type === 'public');
    const privateInstances = deployedInstances.filter((instance) => instance.type === 'private');

    console.log('Public Instances:', publicInstances);
    console.log('Private Instances:', privateInstances);
  });
});
