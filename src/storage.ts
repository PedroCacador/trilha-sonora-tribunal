import { get, set, del, getMany } from "idb-keyval";
import type { Track } from "./types";

const ORDER_KEY = "order";

async function getOrder(): Promise<string[]> {
  return (await get<string[]>(ORDER_KEY)) ?? [];
}

export async function requestPersist() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

export async function addTracks(files: File[]): Promise<void> {
  const order = await getOrder();
  for (const file of files) {
    const id = crypto.randomUUID();
    const track: Track = {
      id,
      name: file.name.replace(/\.[^.]+$/, ""),
      blob: file,
    };
    await set(`track:${id}`, track);
    order.push(id);
  }
  await set(ORDER_KEY, order);
}

export async function loadTracks(): Promise<Track[]> {
  const order = await getOrder();
  const tracks = await getMany<Track>(order.map((id) => `track:${id}`));
  return tracks.filter((t): t is Track => !!t);
}

export async function removeTrack(id: string): Promise<void> {
  await del(`track:${id}`);
  const order = await getOrder();
  await set(
    ORDER_KEY,
    order.filter((x) => x !== id)
  );
}

export async function saveOrder(ids: string[]): Promise<void> {
  await set(ORDER_KEY, ids);
}
