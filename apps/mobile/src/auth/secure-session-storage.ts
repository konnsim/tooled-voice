import * as SecureStore from "expo-secure-store";

const CHUNK = 1800;
export const secureSessionStorage = {
  async getItem(key: string) {
    const count = Number((await SecureStore.getItemAsync(`${key}.count`)) ?? 0);
    if (!count) return null;
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${i}`)
      )
    );
    return chunks.every(Boolean) ? chunks.join("") : null;
  },
  async removeItem(key: string) {
    const count = Number((await SecureStore.getItemAsync(`${key}.count`)) ?? 0);
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.deleteItemAsync(`${key}.${i}`)
      )
    );
    await SecureStore.deleteItemAsync(`${key}.count`);
  },
  async setItem(key: string, value: string) {
    await this.removeItem(key);
    const chunks = value.match(new RegExp(`.{1,${CHUNK}}`, "gs")) ?? [];
    await Promise.all(
      chunks.map((chunk, i) => SecureStore.setItemAsync(`${key}.${i}`, chunk))
    );
    await SecureStore.setItemAsync(`${key}.count`, String(chunks.length));
  },
};
