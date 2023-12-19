#!/usr/bin/env deno run --allow-run --allow-read
import * as path from "https://deno.land/std@0.209.0/path/mod.ts";
import * as fs from "https://deno.land/std@0.209.0/fs/mod.ts";

let requestId = 0;

function jsonEnvelope(body) {
  requestId++;
  return Object.assign({
    "jsonrpc": "2.0",
    "id": requestId,
  }, body);
}

function getHoverMessage(path, line, column) {
  return {
    method: "textDocument/hover",
    params: {
      textDocument: {
        uri: "file://" + path,
      },
      position: {
        // These numbers are zero-based.
        line: line,
        character: column,
      },
    },
  };
  return hoverMessage;
}

// findProjectPath tries to find the root project which contains `filePath`.
// Do this by searching ancestor directories for a .git folder. If none are found, use the parent
// directory of filePath as the project path.
async function findProjectPath(filePath) {
  let dirName = filePath;
  do {
    dirName = path.dirname(dirName);
    const gitDir = path.join(dirName, ".git");
    if (await fs.exists(gitDir)) return dirName;
  } while (dirName != "/");

  return path.dirname(filePath);
}

function getInitializeMessage(projectPath) {
  return {
    method: "initialize",
    params: {
      processId: null,
      rootPath: projectPath,
      workspaceFolders: [
        { uri: "file:/" + projectPath, name: "/" },
      ],
    },
  };
}

const initializedMessage = {
  method: "initialized",
  params: {},
};

function buildRequest(body) {
  const message = JSON.stringify(jsonEnvelope(body), null, 2);
  const contentLength = message.length;
  return `Content-Length: ${contentLength}\r\n\r\n${message}`;
}

async function sendMessage(writer, body) {
  await writer.write(new TextEncoder().encode(buildRequest(body)));
}

function newTimeoutPromise(ms) {
  const timeoutPromise = new Promise((resolve, _reject) => {
    setTimeout(() => resolve(), ms);
  });
  return timeoutPromise;
}

function readMessageBody(string) {
  const groups = string.match(/Content-Length: (\d+)\r\n\r\n/);
  if (groups == null || groups.length < 2) {
    throw new Error("Missing header field in message:" + string);
  }
  const headerLength = groups[0].length;
  const contentLength = parseInt(groups[1]);
  const body = string.slice(headerLength, headerLength + contentLength);
  return body;
}

function printStderr(str) {
  const uint8array = new TextEncoder("UTF-8").encode(JSON.stringify(str));
  Deno.stderr.writeSync(uint8array);
}

async function waitForResult(requestId, reader) {
  // TODO(philc): This isn't robustly engineered to handle large messages which will span multiple
  // read calls.
  const buffer = new Uint8Array(10 * 1024);
  const decoder = new TextDecoder("UTF-8");
  while (true) {
    const result = await reader.read(buffer);
    const string = decoder.decode(result.value);
    // await printStderr(string);
    const body = readMessageBody(string);
    const json = JSON.parse(body);
    if (json.id == requestId) {
      return json;
    }
  }
}

const usage = "client.js doc file:line:column";

// - fileString: a path of the form file.txt:line:column, where line and column are ints.
// Returns [path, line, column].
function parseFileWithCursor(fileString) {
  const parts = fileString.split(":");
  if (parts.length != 3) {
    throw new Error("Invalid path format", fileString);
  }
  const path = parts[0];
  const line = parseInt(parts[1]);
  const column = parseInt(parts[2]);
  return [path, line, column];
}

async function main() {
  if (Deno.args.length != 2) {
    console.log(usage);
    Deno.exit(1);
  }

  const [path, line, column] = parseFileWithCursor(Deno.args[1]);

  const command = new Deno.Command("gopls", {
    args: ["--logfile", "./log.txt", "serve"],
    stdout: "piped",
    stderr: "piped",
    stdin: "piped",
  });

  const process = command.spawn();
  process.stderr.pipeTo(Deno.stderr.writable);

  const writer = process.stdin.getWriter();
  const reader = process.stdout.getReader();

  // Setup the state of the LSP.
  const projectPath = await findProjectPath(path);
  await sendMessage(writer, getInitializeMessage(projectPath));
  await sendMessage(writer, initializedMessage);

  // Execute the "doc" command.
  await sendMessage(writer, getHoverMessage(path, line, column));
  const response = await waitForResult(requestId, reader);

  let output;
  if (response.result.error) {
    output = response.result.error;
  } else {
    output = response.result.contents.value;
  }
  console.log(output);

  // This will signal to the child process to terminate.
  writer.close();

  const result = await process.status;
}

const isInTests = import.meta.url != Deno.mainModule;
if (!isInTests) {
  await main();
}

// Exported for tests.
export { findProjectPath, parseFileWithCursor, readMessageBody };
