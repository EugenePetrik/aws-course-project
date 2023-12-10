import { type ForwardOptions, type SshOptions, type ServerOptions, type TunnelOptions, createTunnel } from 'tunnel-ssh';
import mysql from 'mysql2/promise';
import { join } from 'path';
import { readFileSync } from 'fs';
import { expect } from 'chai';
import { DescribeInstancesCommand, type DescribeInstancesCommandOutput, EC2Client } from '@aws-sdk/client-ec2';
import {
  type DBInstance,
  DescribeDBInstancesCommand,
  type DescribeDBInstancesCommandOutput,
  RDSClient,
} from '@aws-sdk/client-rds';
import { BaseConfig } from '../../BaseConfig';

describe('MySQL RDS connection via SSH tunnel', () => {
  const { accessKeyId, secretAccessKey, region, dbUsername, dbPassword, dbName, dbPort } = BaseConfig;

  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const rdsClient: RDSClient = new RDSClient({ region });

  const rdsPrefix: string = 'cloudximage-databasemysqlinstanced';

  let ec2IpAddress: string = null;
  let rdsEndpoint: string = null;

  before(async function () {
    const params = {
      Filters: [
        {
          Name: 'instance-state-name',
          Values: ['running'],
        },
      ],
    };

    const data: DescribeInstancesCommandOutput = await ec2Client.send(new DescribeInstancesCommand(params));

    const deployedInstances: any[] = data.Reservations.reduce((acc, reservation) => {
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

    const ec2Instance: any = deployedInstances.find((instance) => instance.type === 'public');

    if (!ec2Instance) throw new Error(`No public EC2 instance found`);

    ({ PublicIpAddress: ec2IpAddress } = ec2Instance.os);

    const command: DescribeDBInstancesCommand = new DescribeDBInstancesCommand({});
    const response: DescribeDBInstancesCommandOutput = await rdsClient.send(command);
    const rdsInstances: DBInstance[] = response.DBInstances;

    const rdsInstance: DBInstance = rdsInstances.find((rds) => rds.DBInstanceIdentifier.includes(rdsPrefix));

    if (!rdsInstance) throw new Error(`No MySQL RDS found with prefix: ${rdsPrefix}`);

    rdsEndpoint = rdsInstance.Endpoint.Address;
  });

  it('should connect to MySQL RDS and show tables', async () => {
    const options: SshOptions = {
      host: ec2IpAddress,
      username: 'ec2-user',
      privateKey: readFileSync(join(process.cwd(), 'credentials', 'cloudximage-us-east-1.pem'), 'utf8'),
      port: 22,
    };

    async function sshTunnel(sshOptions: SshOptions, port: number, autoClose = true): Promise<void> {
      const forwardOptions: ForwardOptions = {
        srcAddr: '127.0.0.1',
        srcPort: 3306,
        dstAddr: rdsEndpoint,
        dstPort: Number(dbPort),
      };

      const tunnelOptions: TunnelOptions = {
        autoClose,
      };

      const serverOptions: ServerOptions = {
        port,
      };

      await createTunnel(tunnelOptions, serverOptions, sshOptions, forwardOptions);
    }

    await sshTunnel(options, 3306);

    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: dbUsername,
      password: dbPassword,
      port: 3306,
      database: dbName,
    });

    const [rows] = await connection.query('SHOW TABLES;');
    // eslint-disable-next-line no-console
    console.log('Tables in the database:', rows);
    // OUTPUT: Tables in the database: [ { Tables_in_cloudximages: 'images' } ]

    expect(rows).to.exist;
    expect(rows).to.be.an('array').that.is.not.empty;

    await connection.end();
  });
});
