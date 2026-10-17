/*
 * An app under test that knows nothing about danwo: official AWS SDK clients with their default
 * AWS endpoints (virtual-hosted S3, regional SQS). Prints what it saw as JSON.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import {
  CreateQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs"

const bucket = process.env.APP_BUCKET ?? "danwo-app"
const out = {}
const s3 = new S3Client({ region: "us-east-1", maxAttempts: 1 })
const sqs = new SQSClient({ region: "us-east-1", maxAttempts: 1 })

try {
  if (process.env.APP_CREATE_BUCKET === "1")
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "reports/a.txt",
      Body: "hello",
      ContentType: "text/plain",
    }),
  )
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "reports/a.txt" }))

  out.object = await object.Body?.transformToString()
  const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "reports/" }))

  out.keys = (list.Contents ?? []).map((o) => o.Key)
} catch (error) {
  out.s3Error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

try {
  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: "danwo-jobs" }))

  await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: "job-1" }))
  const received = await sqs.send(new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 1 }))

  out.message = received.Messages?.[0]?.Body
} catch (error) {
  out.sqsError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

process.stdout.write(JSON.stringify(out))
