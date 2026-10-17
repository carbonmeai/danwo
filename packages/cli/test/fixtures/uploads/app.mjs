import { createServer } from "node:http"

/*
 * An app under test that stores uploads in Tigris with the official S3 client and knows nothing
 * about danwo: its traffic reaches the S3 emulator through the proxy. It counts an upload as
 * saved only once S3 accepted it.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

const client = new S3Client({
  endpoint: "https://t3.storage.dev",
  region: "auto",
  credentials: { accessKeyId: "tid_fixture", secretAccessKey: "tsec_fixture" },
})
let saved = 0

async function upload(name, res) {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: "danwo-uploads",
        Key: `uploads/${name}`,
        Body: `report ${name}`,
        ContentType: "text/plain",
      }),
    )
    saved += 1
    res.writeHead(201).end()
  } catch (error) {
    res.writeHead(502).end(String(error))
  }
}

// POST /upload?name=… stores a file; anything else answers how many uploads were saved.
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")

  if (req.method !== "POST") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ saved }))
  } else {
    void upload(url.searchParams.get("name"), res)
  }
})

server.listen(0, "127.0.0.1", () => console.log(`listening ${server.address().port}`))
