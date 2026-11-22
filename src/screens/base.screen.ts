import { InlineKeyboard } from 'grammy';
import { MyContext } from '../types/context.js';

export interface RenderResult {
  text: string;
  reply_markup?: InlineKeyboard;
  displayType: 'main_menu' | 'ticket'; 
  forceNew?: boolean;
  keepUserMessage?: boolean;
  documentPath?: string;
}

export interface BaseScreen {
  readonly id: string;
  render(ctx: MyContext, notice?: string): Promise<RenderResult> | RenderResult;
  handle(ctx: MyContext): Promise<BaseScreen | null>;
}
