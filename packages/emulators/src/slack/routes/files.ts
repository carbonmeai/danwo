import type { Context } from "../../http.ts"
import type { ApiCall, Methods, SlackRouteContext } from "../context.ts"
import type { FileRecord } from "../entities.ts"
import { fileObject } from "../formatters.ts"
import {
  asObject,
  FILES_BASE,
  jsonArg,
  requireArg,
  SlackApiError,
  slackId,
  stringArg,
} from "../helpers.ts"
import { requireChannel, requireMember } from "../lookup.ts"
import { authorOf, postMessage } from "../posting.ts"

const WRITE = ["files:write"]

function getUploadUrlMethod(call: ApiCall) {
  const name = requireArg(call.args, "filename", "invalid_arguments")
  const length = Number(requireArg(call.args, "length", "invalid_arguments"))

  if (!Number.isInteger(length) || length < 0) throw new SlackApiError("invalid_arguments")

  const file = call.context.slack.files.insert({
    fileId: slackId("F"),
    appId: call.token.appId,
    user: call.token.userId,
    name,
    length,
    content: null,
    title: name,
  })

  return { upload_url: `${FILES_BASE}/upload/v1/${file.fileId}`, file_id: file.fileId }
}

/** The `files` argument of `completeUploadExternal`: `[{ id, title? }]`. */
function uploadsOf(call: ApiCall): FileRecord[] {
  const { slack } = call.context
  const list = jsonArg(call.args, "files")

  if (!Array.isArray(list) || list.length === 0) throw new SlackApiError("invalid_arguments")

  return list.map((item) => {
    const entry = asObject(item)
    const file = slack.files.findOneBy("fileId", typeof entry?.id === "string" ? entry.id : "")

    if (!file || file.appId !== call.token.appId || file.content === null)
      throw new SlackApiError("file_not_found")

    const title = typeof entry?.title === "string" ? entry.title : file.title

    return slack.files.update(file.id, { title }) ?? file
  })
}

function completeUploadMethod(call: ApiCall) {
  const files = uploadsOf(call)
  const channelId = stringArg(call.args, "channel_id")

  if (channelId !== undefined) {
    const channel = requireChannel(call.context.slack, channelId)

    requireMember(channel, call.token.userId)
    postMessage(call.context, channel, authorOf(call.context.slack, call.token), {
      text: stringArg(call.args, "initial_comment") ?? "",
      threadTs: stringArg(call.args, "thread_ts") ?? null,
      files: files.map((file) => ({
        id: file.fileId,
        name: file.name,
        title: file.title,
        size: file.length,
      })),
    })
  }

  return { files: files.map(fileObject) }
}

/** Takes the bytes of a reserved upload: the raw body, or the file part of a multipart form. */
async function receiveUpload(c: Context, context: SlackRouteContext): Promise<Response> {
  const file = context.slack.files.findOneBy("fileId", c.req.param("id"))

  if (!file) return c.text("file_not_found", 404)

  const part = Object.values(await c.req.parseBody()).find((value) => value instanceof File)
  const bytes = part instanceof File ? await part.arrayBuffer() : await c.req.arrayBuffer()

  context.slack.files.update(file.id, { content: Buffer.from(bytes).toString("base64") })

  return c.text(`OK - ${bytes.byteLength}`)
}

/** The upload URL `files.getUploadURLExternal` hands out, on `files.slack.com`. */
export function fileRoutes(context: SlackRouteContext): void {
  context.app.post("/upload/v1/:id", (c) => receiveUpload(c, context))
}

/** `files.getUploadURLExternal` and `files.completeUploadExternal`. */
export const fileMethods: Methods = {
  "files.getUploadURLExternal": { scopes: WRITE, run: getUploadUrlMethod },
  "files.completeUploadExternal": { scopes: WRITE, run: completeUploadMethod },
}
