/**
 * 题库 · 算法题（第二轮扩充）。
 *
 * 这一批的共同点是「有固定解题步骤」：快排的分区、归并的合并、二分的边界收缩、
 * 窗口的扩张收缩。每道题都挂了 `diagramId`，答案区顶部直接给步骤图，
 * 先看流程再读代码 —— 纯文字讲指针移动是讲不清的。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_ALGORITHM: readonly InterviewQuestion[] = [
  {
    id: "algo-quicksort",
    title: "手写快速排序，并说明最坏情况怎么发生",
    stem: "实现原地快速排序，讲清分区（partition）的指针走法，并说明什么时候会退化成 O(n²)、怎么缓解。",
    diagramId: "dg-quicksort",
    answer: `- 三步固定：**选基准** → **分区**（小于基准的换到左边）→ **递归左右两段**。基准归位后它就在最终位置上，不用再参与排序。
- 分区用双指针：\`i\` 指向「已确认小于基准」的区间末尾，\`j\` 从头扫，遇到小的就 \`swap(++i, j)\`，扫完把基准换到 \`i + 1\`。
- 最坏 O(n²)：数组已有序且固定取末位基准，每次只切掉一个元素。缓解办法是**随机基准**或**三数取中**。
- 快排**不稳定**：分区时的远距离交换会打乱相等元素的相对顺序。
\`\`\`ts
function quickSort(nums: number[], lo = 0, hi = nums.length - 1): number[] {
  if (lo >= hi) return nums;
  // 随机基准换到末位，避免有序数组退化
  const pick = lo + Math.floor(Math.random() * (hi - lo + 1));
  [nums[pick], nums[hi]] = [nums[hi], nums[pick]];
  const pivot = nums[hi];
  let i = lo - 1;
  for (let j = lo; j < hi; j += 1) {
    if (nums[j] <= pivot) {
      i += 1;
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
  }
  [nums[i + 1], nums[hi]] = [nums[hi], nums[i + 1]];
  quickSort(nums, lo, i);
  quickSort(nums, i + 2, hi);
  return nums;
}
\`\`\`
- 追问：小数组（< 10）切插入排序更快；要稳定就换归并；只求第 K 大就用快选，只递归一侧，均摊 O(n)。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "手写", "高频"],
    topic: "排序与查找 · 分治",
    reviewedAt: "2026-11",
    heat: 91,
    updatedAt: "2026-11-16",
  },
  {
    id: "algo-mergesort",
    title: "手写归并排序，说明它为什么稳定、代价是什么",
    stem: "实现归并排序（递归版），讲清合并两个有序数组的写法，并对比快排说明取舍。",
    diagramId: "dg-mergesort",
    answer: `- 骨架是「拆到单元素 → 两两合并」：拆分不费劲，真正的活在 \`merge\`。
- \`merge\` 双指针各扫一段，**相等时优先取左段**，这就是稳定性的来源；改成取右就不稳定了。
- 复杂度恒为 O(n log n)，与初始顺序无关；代价是 O(n) 辅助空间。
- 链表排序更适合归并：合并链表不需要额外数组，还省掉了随机访问。
\`\`\`ts
function mergeSort(nums: number[]): number[] {
  if (nums.length <= 1) return nums;
  const mid = nums.length >> 1;
  const left = mergeSort(nums.slice(0, mid));
  const right = mergeSort(nums.slice(mid));
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++]);
    else out.push(right[j++]);
  }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}
\`\`\`
- 追问：外部排序（内存放不下）分块排序再多路归并；求逆序对就是在合并阶段数「右段先出」的次数。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "手写", "分治"],
    topic: "排序与查找 · 分治",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-15",
  },
  {
    id: "algo-binary-search-bound",
    title: "二分查找：手写「第一个 ≥ target」的边界版本",
    stem: "在升序数组中找第一个大于等于 target 的下标（不存在返回数组长度），说明循环不变量与边界写法。",
    diagramId: "dg-binary-search",
    answer: `- 循环不变量是「答案一定在 \`[left, right]\` 里」。左闭右闭配 \`left <= right\` 与 \`mid ± 1\`，左闭右开配 \`left < right\` 与 \`right = mid\`，**两套不能混**。
- 求下界时命中不能提前返回：把 \`right\` 压到 \`mid\` 继续往左找，循环结束时 \`left\` 就是答案。
- \`mid = left + ((right - left) >> 1)\` 既防溢出又天然向下取整，避免死循环。
\`\`\`ts
function lowerBound(nums: number[], target: number): number {
  let left = 0;
  let right = nums.length; // 左闭右开
  while (left < right) {
    const mid = left + ((right - left) >> 1);
    if (nums[mid] < target) left = mid + 1;
    else right = mid;
  }
  return left; // 第一个 >= target 的位置，可能等于长度
}
\`\`\`
- 同模板能解：第一个 > target（\`nums[mid] <= target\` 时右移）、最后一个 ≤ target、插入位置、有序矩阵找目标。
- 「二分答案」类题（最小可行容量、最小速度）也是它：判定函数随答案单调即可二分。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "手写", "高频"],
    topic: "排序与查找 · 二分",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-16",
  },
  {
    id: "algo-sliding-window-longest",
    title: "滑动窗口：无重复字符的最长子串",
    stem: "给定字符串，求不含重复字符的最长子串长度，要求 O(n)，并说明窗口扩张与收缩的时机。",
    diagramId: "dg-sliding-window",
    answer: `- 窗口是一段连续区间：**右端扩张**把新字符纳入，**左端收缩**直到窗口重新满足「无重复」。
- 用 \`Map<char, index>\` 记字符最后出现的位置，\`left\` 直接跳到「重复字符的下一位」，不用一格一格挪。
- 两个指针都只前进，所以总复杂度 O(n)；每次扩张后更新答案。
\`\`\`ts
function lengthOfLongestSubstring(text: string): number {
  const last = new Map<string, number>();
  let left = 0;
  let best = 0;
  for (let right = 0; right < text.length; right += 1) {
    const seen = last.get(text[right]);
    // 只有在窗口内的重复才需要收缩
    if (seen !== undefined && seen >= left) left = seen + 1;
    last.set(text[right], right);
    best = Math.max(best, right - left + 1);
  }
  return best;
}
\`\`\`
- 易错点：\`seen < left\` 的旧下标不能用来收缩，否则 \`left\` 会往回跳，窗口变成非法状态。
- 同模板：最小覆盖子串（need/have 计数）、长度最小的子数组（和 ≥ target）、最多 K 个不同字符。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "高频", "双指针"],
    topic: "数组与字符串 · 滑动窗口",
    reviewedAt: "2026-11",
    heat: 90,
    updatedAt: "2026-11-14",
  },
  {
    id: "algo-lis-length",
    title: "最长递增子序列：O(n log n) 的贪心 + 二分",
    stem: "求数组的最长严格递增子序列长度，要求 O(n log n)，并说明 tails 数组的含义。",
    diagramId: "dg-lis",
    answer: `- \`tails[i]\` 的含义是「长度为 i+1 的递增子序列，最小可能的结尾值」。同样长度下结尾越小，后面越容易接。
- 每来一个数 x，二分找 \`tails\` 中第一个 **≥ x** 的位置并替换；找不到就追加到末尾。
- 替换而不是插入，是贪心成立的关键；\`tails\` 的长度就是答案。
- 注意：\`tails\` **不是**那个子序列本身，要还原具体元素还得额外记录前驱下标。
\`\`\`ts
function lisLength(nums: number[]): number {
  const tails: number[] = [];
  for (const value of nums) {
    let left = 0;
    let right = tails.length;
    while (left < right) {
      const mid = left + ((right - left) >> 1);
      if (tails[mid] < value) left = mid + 1;
      else right = mid;
    }
    tails[left] = value;
  }
  return tails.length;
}
\`\`\`
- 严格递增用 \`< value\`；非递减（允许相等）改成 \`<= value\`，一处之差决定结果。
- 这就是 Vue 3 diff 里「哪些节点不用移动」的算法，只是它求的是下标数组版本。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "hard",
    tags: ["算法", "进阶", "大厂"],
    topic: "动态规划 · 贪心与二分",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-13",
  },
  {
    id: "algo-quickselect-kth",
    title: "求第 K 大元素：快选为什么是 O(n)",
    stem: "在无序数组中找第 k 大的元素，要求平均 O(n)，说明它和快排的关系。",
    answer: `- 快选（quickselect）复用快排的分区：每次分区后基准落到最终位置，只递归**包含答案的那一侧**。
- 递归式是 \`T(n) = T(n/2) + O(n)\`，等比级数求和后是 O(n)；最坏（每次只切一个）仍是 O(n²)，随机基准可压回期望 O(n)。
- 第 k 大 = 升序第 \`n - k\` 小，用这个下标去比基准位置，避免写两套逻辑。
\`\`\`ts
function kthLargest(nums: number[], k: number): number {
  const target = nums.length - k;
  let lo = 0;
  let hi = nums.length - 1;
  while (lo < hi) {
    const pivot = nums[hi];
    let i = lo - 1;
    for (let j = lo; j < hi; j += 1) {
      if (nums[j] <= pivot) {
        i += 1;
        [nums[i], nums[j]] = [nums[j], nums[i]];
      }
    }
    [nums[i + 1], nums[hi]] = [nums[hi], nums[i + 1]];
    const pos = i + 1;
    if (pos === target) return nums[pos];
    if (pos < target) lo = pos + 1;
    else hi = pos - 1;
  }
  return nums[lo];
}
\`\`\`
- 另一条路是「大小为 K 的小顶堆」，O(n log k)，适合数据流场景（随时插入、随时取第 K 大）。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "hard",
    tags: ["算法", "大厂", "进阶"],
    topic: "排序与查找 · 快选",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-12",
  },
  {
    id: "algo-backtrack-permute",
    title: "回溯：全排列与组合总和，讲清「撤销选择」",
    stem: "写全排列，并说明回溯三步（选择、递归、撤销）为什么必须对称，以及怎么剪枝。",
    answer: `- 回溯是「带撤销的 DFS」：每一层做一次选择，递归到底部收集结果，返回前把状态改回去。
- **撤销必须与选择严格对称**：\`push\` 对应 \`pop\`，标记对应清除。漏一处就会污染兄弟分支，表现为「答案里出现重复元素」。
- 剪枝才有实用价值：排序后跳过同层重复值、提前判断剩余和是否够用。
\`\`\`ts
function permute(nums: number[]): number[][] {
  const out: number[][] = [];
  const path: number[] = [];
  const used = new Array(nums.length).fill(false);
  const walk = (): void => {
    if (path.length === nums.length) {
      out.push([...path]); // 必须拷贝，path 会被复用
      return;
    }
    for (let i = 0; i < nums.length; i += 1) {
      if (used[i]) continue;
      used[i] = true;
      path.push(nums[i]);
      walk();
      path.pop();       // 撤销：与 push 对称
      used[i] = false;  // 撤销：与标记对称
    }
  };
  walk();
  return out;
}
\`\`\`
- 复杂度 O(n × n!)：共 n! 个结果，每个结果拷贝一次长度 n 的路径。
- 去重版本（含重复元素）要先排序，再加 \`i > 0 && nums[i] === nums[i-1] && !used[i-1]\` 跳过。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "手写", "基础"],
    topic: "回溯 · 排列组合",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-11",
  },
  {
    id: "algo-linked-cycle-reverse",
    title: "链表反转、判环与找环入口（一套母题三个变体）",
    stem: "写单链表反转，并说明如何判断有环、如何求环的入口，要求 O(1) 空间。",
    answer: `- 反转用三指针 \`prev/cur/next\`：先存 \`next\`，再改指向，最后整体前移。边界靠 \`prev = null\` 自然收尾。
- 判环用快慢指针：慢走一步、快走两步，相遇即**有环**；快指针走到 \`null\` 则无环。
- 找入口：相遇后把一个指针放回头部，两者都改为每次一步，**再次相遇处就是入口**（推导：慢指针路程是快指针一半）。
\`\`\`ts
interface ListNode { val: number; next: ListNode | null }
function reverseList(head: ListNode | null): ListNode | null {
  let prev: ListNode | null = null;
  let cur = head;
  while (cur) {
    const next: ListNode | null = cur.next;
    cur.next = prev;
    prev = cur;
    cur = next;
  }
  return prev;
}
function detectCycle(head: ListNode | null): ListNode | null {
  let slow = head;
  let fast = head;
  while (fast && fast.next) {
    slow = slow!.next;
    fast = fast.next.next;
    if (slow === fast) {
      let cursor = head;
      while (cursor !== slow) {
        cursor = cursor!.next;
        slow = slow!.next;
      }
      return cursor;
    }
  }
  return null;
}
\`\`\`
- 链表题的通用技巧是 **dummy 头节点**：合并、删除、分区都不必单独处理头节点为空的情况。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "basic",
    tags: ["算法", "高频", "基础"],
    topic: "链表 · 双指针",
    reviewedAt: "2026-11",
    heat: 85,
    updatedAt: "2026-10-28",
  },
];
