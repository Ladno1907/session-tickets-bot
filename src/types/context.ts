import { Context, SessionFlavor } from "grammy";

export interface BotSessionData {
  currentScreenId: string;
  meta: Record<string, any>; 
}

export interface MyContext extends Context, SessionFlavor<BotSessionData> {}
