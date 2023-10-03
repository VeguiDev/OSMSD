import naudiodon from "naudiodon";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import ffmpeg from "fluent-ffmpeg";
import express, { Response } from "express";
import { PassThrough, Stream, Writable, Readable } from "node:stream";

const app = express();
const streams = new Map<string, PassThrough>();

const generateStream = () => {
  const id = Math.random().toString(36).slice(2);
  const stream = new PassThrough();

  streams.set(id, stream);
  return { id, stream };
};

const broadcastToEveryStreams = (chunk: Buffer) => {
  for (let [id, res] of streams) {
    res.write(chunk); // We write to the client stream the new chunck of data
  }
};

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    connection: "keep-alive",
    // "transfer-encoding": "chunked",
  });

  const { id, stream } = generateStream();
  stream.pipe(res); // the client stream is pipe to the response
  res.on("close", () => {
    streams.delete(id);
  });
});

async function main() {
  const devices = naudiodon.getDevices();
  const result = await inquirer.prompt([
    {
      type: "list",
      name: "device",
      message: "Select a device",
      choices: devices
        .filter((device) => device.maxInputChannels != 0)
        .map((device) => {
          return {
            name: `${device.name} (${device.maxInputChannels} channels)`,
            value: device.id,
          };
        }),
    },
  ]);

  const device = devices.find((device) => device.id == result.device);

  if (!device) {
    console.log("Device not found");
    process.exit(1);
  }

  var ai = naudiodon.AudioIO({
    inOptions: {
      channelCount: device.maxInputChannels,
      sampleFormat: naudiodon.SampleFormat16Bit,
      sampleRate: 44100,
      deviceId: device.id,
      closeOnError: true,
    },
  });

  const stream = new PassThrough();
  const output = new PassThrough();

  output.on("data", (data) => {
    broadcastToEveryStreams(data);
  });

  const command = ffmpeg()
    .input(stream)
    .inputFormat("s32le")
    .audioCodec("libmp3lame")
    .audioChannels(2)
    .audioFrequency(44100)
    .audioBitrate("12k")
    .audioQuality(0)
    .output(output)
    .outputFormat("mp3")
    .run();

  ai.pipe(stream);
  ai.start();
  // const ffmpeg = cp.spawn("ffmpeg", [
  //   "-f",
  //   "s32le",
  //   "-i",
  //   "-",
  //   "-ar",
  //   "44100",
  //   "-ac",
  //   "2",
  //   "-c:a",
  //   "libmp3lame",
  //   "-f",
  //   "mpeg",
  //   "-",
  // ]);

  // ffmpeg.stdout.on("data", (data) => {
  //   broadcastToEveryStreams(data);
  // });
  // ffmpeg.stderr.pipe(process.stdout);

  process.on("SIGINT", () => {
    console.log("Received SIGINT. Stopping recording.");
    ai.quit();
    // ffmpeg.kill();
    stream.end();
    output.end();
    streams.forEach((stream) => stream.end());
    process.exit();
  });

  app.listen(8080, () => {
    console.log("Running on http://localhost:8080");
  });
}

main();
