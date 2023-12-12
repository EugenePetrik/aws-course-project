import type { AxiosResponse } from 'axios';
import { BaseApiClient } from './BaseApiClient';
import { BaseConfig } from '../../BaseConfig';
import { retryUntil } from '../common';

const { mailtrapUrl, mailtrapToken, mailtrapAccountId, mailtrapInboxId } = BaseConfig;

interface IMailtrapMessage {
  id: string;
  to_email: string;
  subject: string;
  sent_at: string;
}

export class MailtrapApiClient {
  #client: BaseApiClient = new BaseApiClient({
    baseURL: `${mailtrapUrl}/accounts/${mailtrapAccountId}`,
    headers: { 'Api-Token': mailtrapToken },
  });

  async getAllMessages(): Promise<AxiosResponse<Array<IMailtrapMessage>>> {
    return this.#client.get(`/inboxes/${mailtrapInboxId}/messages`);
  }

  async getMessageById(messageId: string): Promise<AxiosResponse<string>> {
    return this.#client.get(`/inboxes/${mailtrapInboxId}/messages/${messageId}/body.html`);
  }

  async getLatestMessageIdBySubject(email: string, subject: string): Promise<string> {
    let messageId: string;

    await retryUntil(
      async () => {
        const allInboxMessages = await this.getAllMessages();

        const filteredMessages = allInboxMessages.data.filter((message) => {
          return message.to_email.includes(email) && message.subject === subject;
        });

        if (filteredMessages.length === 0) {
          throw new Error(`Email sent to "${email}" with subject "${subject}" was not found in Mailtrap`);
        }

        messageId = filteredMessages[0].id;

        return true;
      },
      {
        timesToRepeat: 10,
        timeout: 10_000,
      },
    );

    return messageId;
  }

  async getLatestMessageBySubject(email: string, subject: string): Promise<AxiosResponse<string>> {
    const messageId: string = await this.getLatestMessageIdBySubject(email, subject);
    return this.getMessageById(messageId);
  }
}
