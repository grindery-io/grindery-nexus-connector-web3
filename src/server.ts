import "dotenv/config";
import bodyParser from "body-parser";
import express from "express";
import { Server } from "ws";
import { main } from "./app";
import { Response } from "./utils";

const app = express();
app.use(bodyParser.json());

let debugOutput = "Hello World!";

export function addDebugOutput(output: string) {
  if (debugOutput.length > 10000) {
    debugOutput = "(truncated)";
  }
  debugOutput += `\n[${new Date().toISOString()}] ${output}`;
}

app.use((_req, res) => res.type("text/plain").send(debugOutput));

const port = parseInt(process.env.PORT || "", 10) || 3000;

console.log(`Listening on port ${port}`);
const server = app.listen(port);

const wss = new Server({ server });
wss.on("connection", (ws) => {
  console.log("Client connected");
  ws.on("message", async function message(data) {
    let parsed = {};
    try {
      parsed = JSON.parse(data.toString("utf8"));
    } catch (e) {
      console.error("Invalid message", e);
    }
    const result = await main(parsed, { socket: ws });
    if (result instanceof Response) {
      return;
    }
    ws.send(JSON.stringify(result));
  });
  ws.on("close", () => console.log("Client disconnected"));
});
