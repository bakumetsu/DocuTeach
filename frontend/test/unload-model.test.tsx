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
    const icon = await screen.findByLabelText('Model unloaded. Reload');
    expect(icon.getAttribute('title')).toBe('Model unloaded');
    expect(icon.classList.contains('model-unloaded-icon')).toBe(true);
    expect(screen.queryByText('Model unloaded')).toBeNull();
    expect(useChats.getState().modelStatus[modelOf()]?.status).toBe('unloaded');

    fireEvent.click(screen.getByLabelText('Undo'));
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

describe('chat panel header', () => {
  it('renders header and empty state with the LLM offline and no chats', async () => {
    vi.spyOn(api.models, 'list').mockRejectedValue(new Error('offline'));
    render(<AssistantPane onCollapse={() => {}} />);
    await screen.findByLabelText('Reload model');
    await waitFor(() => expect(useChats.getState().chats.length).toBe(1));
    fireEvent.click(screen.getByLabelText('Close chat'));
    await screen.findByText('No chats');
    fireEvent.click(screen.getByText('New chat'));
    await waitFor(() => expect(useChats.getState().chats.length).toBe(1));
  });

  it('collapsing after unload does not reload the model', async () => {
    const { unmount } = render(<AssistantPane onCollapse={() => {}} />);
    const btn = await screen.findByLabelText('Unload model');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByLabelText('Model unloaded. Reload');
    const sel = vi.spyOn(api.models, 'select');
    unmount();
    render(<AssistantPane onCollapse={() => {}} />);
    await screen.findByLabelText('Model unloaded. Reload');
    expect(sel).not.toHaveBeenCalled();
  });

  it('Reload model button calls reloadModel for the active chat', async () => {
    render(<AssistantPane onCollapse={() => {}} />);
    const btn = await screen.findByLabelText('Reload model');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    const sel = vi.spyOn(api.models, 'select');
    fireEvent.click(btn);
    await waitFor(() => expect(sel).toHaveBeenCalledWith(modelOf()));
    await waitFor(() => expect(useChats.getState().modelStatus[modelOf()]?.status).toBe('ready'));
  });

  it('closing the active of two chats activates the neighbour and renders ChatView', async () => {
    render(<AssistantPane onCollapse={() => {}} />);
    await screen.findByLabelText('Message');
    act(() => useChats.getState().newChat());
    await waitFor(() => expect(useChats.getState().chats.length).toBe(2));
    const [a, b] = useChats.getState().chats;
    expect(useChats.getState().activeId).toBe(b.id);
    fireEvent.click(screen.getAllByLabelText('Close chat')[1]);
    await waitFor(() => expect(useChats.getState().activeId).toBe(a.id));
    expect(screen.queryByText('No chats')).toBeNull();
    await screen.findByLabelText('Message');
  });

  it('Reload refetches the model list after the LLM comes back', async () => {
    const real = api.models.list.bind(api.models);
    vi.spyOn(api.models, 'list').mockRejectedValueOnce(new Error('offline')).mockImplementation(real);
    render(<AssistantPane onCollapse={() => {}} />);
    await waitFor(() => expect(useChats.getState().ready).toBe(true));
    expect(useChats.getState().models).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('Reload model'));
    await waitFor(() => expect(useChats.getState().models.length).toBeGreaterThan(0));
    const m = useChats.getState().models[0].id;
    await waitFor(() => expect(useChats.getState().modelStatus[m]?.status).toBe('ready'));
  });
});
