import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AssistantPane } from '../src/assistant/AssistantPane';
import { useChats, resetChatsForTest } from '../src/assistant/chatStore';
import { api } from '../src/api';
import { mockConfig } from '../src/api/mock/config';

const saved = { ...mockConfig };

beforeEach(() => {
  mockConfig.swapMs = 0;
  mockConfig.loadMs = 0;
  mockConfig.tokenMinMs = 0;
  mockConfig.tokenMaxMs = 1;
  localStorage.clear();
  resetChatsForTest();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.assign(mockConfig, saved);
});

const modelOf = () => {
  const s = useChats.getState();
  return s.chats.find((c) => c.id === s.activeId)!.model;
};

describe('unload model', () => {
  it('click shows "Model unloaded"; Undo reloads', async () => {
    render(<AssistantPane onCollapse={() => {}} />);
    const btn = await screen.findByLabelText('Unload model');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect(await screen.findByText('Model unloaded')).toBeTruthy();
    expect(useChats.getState().modelStatus[modelOf()]?.status).toBe('unloaded');

    fireEvent.click(screen.getByText('Undo'));
    await waitFor(() => expect(useChats.getState().modelStatus[modelOf()]?.status).toBe('ready'));
  });

  it('the next send reloads via selectModel, then streams', async () => {
    await useChats.getState().init();
    const id = useChats.getState().activeId;
    await useChats.getState().unloadModel(id);
    expect(useChats.getState().modelStatus[modelOf()]?.status).toBe('unloaded');

    const sel = vi.spyOn(api.models, 'select');
    await useChats.getState().send(id, 'Hello?');
    expect(sel).toHaveBeenCalledWith(modelOf());
    const chat = useChats.getState().chats.find((c) => c.id === id)!;
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages[1].role).toBe('assistant');
    expect(useChats.getState().modelStatus[modelOf()]?.status).toBe('ready');
  });

  it('asks for confirmation while generating', async () => {
    render(<AssistantPane onCollapse={() => {}} />);
    const btn = await screen.findByLabelText('Unload model');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    act(() => {
      useChats.setState((s) => ({
        chats: s.chats.map((c) => (c.id === s.activeId ? { ...c, phase: 'generating' } : c)),
      }));
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(btn);
    expect(confirm).toHaveBeenCalled();
    expect(useChats.getState().modelStatus[modelOf()]?.status).toBe('ready');
  });
});
