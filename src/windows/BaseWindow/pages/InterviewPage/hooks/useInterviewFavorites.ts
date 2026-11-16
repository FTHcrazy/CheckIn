import { useCallback, useState } from "react";
import {
  readFavorites,
  toggleFavorite,
  writeFavorites,
} from "../data/favorites-storage";

export interface InterviewFavoritesApi {
  /** 收藏的题目 id 集合，供筛选与星标状态使用 */
  favorites: ReadonlySet<string>;
  favoriteCount: number;
  isFavorite: (id: string) => boolean;
  toggle: (id: string) => void;
}

/**
 * 收藏状态。
 *
 * 首帧直接从 localStorage 读：页面刷新后星标不能先空一帧再跳出来。
 * 写入放在 state updater 里是安全的 —— 同一个 id 的两次写入内容完全一致，
 * StrictMode 的双调用只是重复写同一个值。
 */
export function useInterviewFavorites(): InterviewFavoritesApi {
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() =>
    readFavorites(),
  );

  const toggle = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, id);
      writeFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (id: string) => favorites.has(id),
    [favorites],
  );

  return {
    favorites,
    favoriteCount: favorites.size,
    isFavorite,
    toggle,
  };
}
