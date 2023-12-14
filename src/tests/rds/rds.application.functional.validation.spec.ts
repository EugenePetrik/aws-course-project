import { expect } from 'chai';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  type DescribeDBInstancesCommandOutput,
  type DBInstance,
} from '@aws-sdk/client-rds';
import { type ForwardOptions, type SshOptions, type ServerOptions, type TunnelOptions, createTunnel } from 'tunnel-ssh';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import {
  DescribeInstancesCommand,
  type DescribeInstancesCommandOutput,
  EC2Client,
  type DescribeInstancesCommandInput,
} from '@aws-sdk/client-ec2';
import axios, { type AxiosResponse } from 'axios';
import _ from 'lodash';
import fs, { readFileSync } from 'fs-extra';
import { join } from 'path';
import FormData from 'form-data';
import { log } from '../../utilities/common';
import { BaseConfig } from '../../BaseConfig';

describe('RDS application functional validation', () => {
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

  let connection: Connection = null;

  let rdsTableName: string = null;
  let randomImageId: string = null;

  before(async function () {
    // Get EC2 data

    const params: DescribeInstancesCommandInput = {
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

    // Get RDS data

    const command: DescribeDBInstancesCommand = new DescribeDBInstancesCommand({});
    const response: DescribeDBInstancesCommandOutput = await rdsClient.send(command);
    const rdsInstances: DBInstance[] = response.DBInstances;

    const rdsInstance: DBInstance = rdsInstances.find((rds) => rds.DBInstanceIdentifier.includes(rdsPrefix));

    if (!rdsInstance) throw new Error(`No MySQL RDS found with prefix: ${rdsPrefix}`);

    rdsEndpoint = rdsInstance.Endpoint.Address;

    // Create SSH tunnel to MySQL RDS

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

    connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: dbUsername,
      password: dbPassword,
      port: 3306,
      database: dbName,
    });
  });

  after(async () => {
    if (connection && connection.end) {
      await connection.end();
    }
  });

  it('the uploaded image metadata should be stored in MySQL RDS database', async () => {
    const randomImage: string = _.sample(['beach.jpg', 'coffee.jpg', 'tree.jpeg']);
    const filePath: string = join(process.cwd(), 'src', 'testData', randomImage);

    const formData: FormData = new FormData();
    formData.append('upfile', fs.createReadStream(filePath));

    const headers: { [key: string]: string } = {
      'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
      ...formData.getHeaders(),
    };

    const response: AxiosResponse = await axios.post(`http://${ec2IpAddress}/api/image`, formData, { headers });
    expect(response.status, 'Post image response status is not correct').to.equal(200);
    expect(response.data.id, 'Image ID is not correct').to.be.an('number');

    // Get tables
    const [table] = await connection.query('SHOW TABLES;');
    rdsTableName = table?.[0]?.Tables_in_cloudximages;

    // Get columns
    const [columns] = await connection.query(`SHOW COLUMNS FROM ${rdsTableName}`);
    const columnNames = (columns as RowDataPacket[]).map((column) => column.Field);
    log(`Column names in the table: ${columnNames}`);
    expect(columnNames, `Columns names are not correct in the "${rdsTableName}" table`).to.have.members([
      'id',
      'object_key',
      'object_type',
      'last_modified',
      'object_size',
    ]);

    // Get rows
    const [rows] = await connection.query(`SELECT COUNT(*) as count FROM ${rdsTableName};`);
    const rowCount = rows[0].count;
    log(`Number of rows in the table: ${rowCount}`);
    expect(rowCount, `Rows count is not correct in the "${rdsTableName}" table`).to.be.greaterThan(0);

    // Get images IDs
    const [images] = await connection.query('SELECT id FROM images;');
    const imageIds = (images as RowDataPacket[]).map((image) => image.id);
    log(`IDs in the table: ${imageIds}`);
    expect(imageIds, `There are no images IDs in the "${rdsTableName}" table`).to.be.an('array').that.is.not.empty;

    randomImageId = _.sample(imageIds);
  });

  it('the image metadata should be returned by {base URL}/image/{image_id} GET request', async () => {
    const response: AxiosResponse = await axios.get(`http://${ec2IpAddress}/api/image/${randomImageId}`);
    expect(response.status, 'Get image by ID response status is not correct').to.equal(200);

    expect(response.data.object_key, 'object_key in response is not correct').to.exist.and.not.be.empty;
    expect(response.data.object_type, 'object_type in response is not correct').to.exist.and.not.be.empty;
    expect(response.data.last_modified, 'last_modified in response is not correct').to.exist.and.not.be.empty;
    expect(response.data.object_size.toString(), 'object_size in response is not correct').to.exist.and.not.be.empty;
  });

  it('the image metadata for the deleted image should be deleted from the database', async () => {
    const response: AxiosResponse = await axios.delete(`http://${ec2IpAddress}/api/image/${randomImageId}`);
    expect(response.status, 'Delete image by ID response status is not correct').to.equal(200);

    const [images] = await connection.query('SELECT id FROM images;');
    const imageIds = (images as RowDataPacket[]).map((image) => image.id);

    expect(imageIds, `The image ID still exists in the table "${rdsTableName}" after being deleted`).not.to.include(
      randomImageId,
    );
  });
});
