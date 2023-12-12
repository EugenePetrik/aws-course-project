import { randomUUID } from 'node:crypto';
import { formatISO } from 'date-fns';
import { BaseConfig } from '../BaseConfig';

export function generateMailtrapEmail(): string {
  const email: string = BaseConfig.mailtrapEmail;
  return email.replace('%s', randomUUID());
}

export function log(message: string): void {
  const record = `[${formatISO(new Date())}] : ${message}`;
  // eslint-disable-next-line no-console
  console.log(record);
}

async function wait(timeout: number): Promise<unknown> {
  return new Promise((resolve) => {
    // eslint-disable-next-line no-promise-executor-return
    return setTimeout(resolve, timeout);
  });
}

export async function retryUntil<T>(
  cbToPerform: () => Promise<T>,
  { timesToRepeat = 3, timeout = 0 }: { timesToRepeat?: number; timeout?: number } = {},
): Promise<T | boolean> {
  for (let i = 1; i <= timesToRepeat; i += 1) {
    let cbError: any = null;

    const cbResult = await cbToPerform().catch((err) => {
      cbError = err;
      return false;
    });

    if (cbResult) return cbResult;

    log(`retryUntil iteration number ${i}`);

    if (timeout) await wait(timeout);

    if (i === timesToRepeat) {
      const withErrorMsg = cbError ? `with error: ${cbError}\n` : '';
      throw new Error(`RetryUntil failed ${withErrorMsg}Condition wasn't successful:\n${cbToPerform.toString()}`);
    }
  }
}
