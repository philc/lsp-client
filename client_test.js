import * as shoulda from "https://deno.land/x/shoulda@v2.0/shoulda.js";
const { assert, context, should } = shoulda;
import * as path from "https://deno.land/std@0.209.0/path/mod.ts";
import * as client from "./client.js";

context("tests", () => {
  should("readMessageBody", () => {
    // Here, content-length indicates that we should only cocnsider up to the char "4" as part of
    // this message's body.
    const message = "Content-Length: 5\r\n\r\n0123456";
    const result = client.readMessageBody(message);
    assert.equal("01234", result);
  });

  should("parseFileWithCursor", () => {
    const [path, line, column] = client.parseFileWithCursor("dir/file.txt:1:2");
    assert.equal("dir/file.txt", path);
    assert.equal(1, line);
    assert.equal(2, column);
  });

  should("findProjectPath", async () => {
    // The current repo is has a .git folder and is a valid project path.
    const path1 = path.join(Deno.cwd(), "./client_test.js");
    assert.equal(Deno.cwd(), await client.findProjectPath(path1));
    const path2 = path.join("/non-existant1/non-existant2.txt");
    assert.equal("/non-existant1", await client.findProjectPath(path2));
  });
});
