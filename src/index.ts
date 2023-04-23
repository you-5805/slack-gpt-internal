import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET } from './env';
import { App, ExpressReceiver } from '@slack/bolt';
import { askAi } from './langchain';

const receiver = new ExpressReceiver({
  signingSecret: SLACK_SIGNING_SECRET,
  scopes: ['chat:write'],
  endpoints: '/events',
  processBeforeResponse: true,
});

const app = new App({ receiver, token: SLACK_BOT_TOKEN });

app.event(
  'app_mention',
  async ({ event: { ts, thread_ts, text, channel, user }, say, logger, client, context: { botUserId } }) => {
    logger.info(`Received message: ${text}, ts: ${ts}`);

    const history =
      thread_ts !== undefined
        ? await client.conversations.replies({ channel, ts: thread_ts ?? ts }).then(
            (replies) =>
              replies.messages?.map((reply) => ({
                by: reply.user === botUserId ? ('bot' as const) : ('user' as const),
                text: reply.text?.replace(/<@.*?>/g, '').trim() ?? '',
              })) ?? [],
          )
        : [];

    console.log({ history });

    const isInlineMode = thread_ts === undefined && text.includes('--inline');
    const sentMessage = await (async () => {
      if (isInlineMode) {
        return say('考え中です...🧐');
      } else {
        return client.chat.postMessage({
          text: '考え中です...🧐',
          thread_ts: thread_ts ?? ts,
          channel,
        });
      }
    })();

    const message = text.replace(/<@.*?>/g, '').trim();
    askAi(message, history)
      .then(async (result) => {
        logger.info(`Result: ${result}, ts: ${ts}`);
        if (sentMessage.ts === undefined) return;

        const replyContent = `${user !== undefined ? `<@${user}> ` : ''}${result}`;
        if (isInlineMode) {
          await say(replyContent);
        } else {
          await client.chat.postMessage({
            text: replyContent,
            channel,
            thread_ts: thread_ts ?? ts,
          });
        }

        await client.chat.delete({
          ts: sentMessage.ts,
          channel,
        });
      })
      .catch(async (err) => {
        if (sentMessage.ts === undefined) return;

        const replyContent = `${user !== undefined ? `<@${user}> ` : ''}タイムアウトしました`;
        logger.error(err);
        if (isInlineMode) {
          await say(replyContent);
        } else {
          await client.chat.postMessage({
            text: replyContent,
            channel,
            thread_ts: thread_ts ?? ts,
          });
        }

        await client.chat.delete({
          ts: sentMessage.ts,
          channel,
        });
      });
    return;
  },
);

export const handleGpt = receiver.app;
