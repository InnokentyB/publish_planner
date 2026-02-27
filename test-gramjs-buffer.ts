import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import * as fs from "fs";
import { config } from "dotenv";
config();

// Just check if CustomFile can be imported and instantiated
const file = new CustomFile("test.jpg", 100, "", Buffer.from("test"));
console.log(file);
