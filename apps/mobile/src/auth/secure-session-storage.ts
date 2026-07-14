import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";

const CHUNK = 1800;
export const secureSessionStorage = {
  async getItem(key: string) {
    const count = Number((await getItemAsync(`${key}.count`)) ?? 0);
    if (!count) {
      return null;
    }
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, i) => getItemAsync(`${key}.${i}`))
    );
    return chunks.every(Boolean) ? chunks.join("") : null;
  },
  async removeItem(key: string) {
    const count = Number((await getItemAsync(`${key}.count`)) ?? 0);
    await Promise.all(
      Array.from({ length: count }, (_, i) => deleteItemAsync(`${key}.${i}`))
    );
    await deleteItemAsync(`${key}.count`);
  },
  async setItem(key: string, value: string) {
    await this.removeItem(key);
    const chunks = value.match(new RegExp(`.{1,${CHUNK}}`, "gs")) ?? [];
    await Promise.all(
      chunks.map((chunk, i) => setItemAsync(`${key}.${i}`, chunk))
    );
    await setItemAsync(`${key}.count`, String(chunks.length));
  },
};
