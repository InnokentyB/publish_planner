"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const planner_service_1 = __importDefault(require("./services/planner.service"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
async function main() {
    console.log('Testing createWeek...');
    const now = new Date();
    // Use fixed dates to avoid logic issues
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    try {
        const week = await planner_service_1.default.createWeek(1, "Debug Theme", start, end);
        console.log('Week created:', week);
    }
    catch (e) {
        console.error('Create Week Failed:', e);
    }
}
main();
