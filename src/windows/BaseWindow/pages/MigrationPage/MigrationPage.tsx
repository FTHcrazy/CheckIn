import type { ReactNode } from "react";
import { Alert } from "antd";
import { CheckSquareOutlined, EditOutlined } from "@ant-design/icons";
import type { MigrationScope } from "@/shared/types/electron";
import Page from "@/shared/components/Page";
import MigrationScopeCard from "./components/MigrationScopeCard";
import MigrationActions from "./components/MigrationActions";
import { useMigration } from "./hooks/useMigration";
import "./index.scss";

interface ScopeMeta {
  key: MigrationScope;
  icon: ReactNode;
  title: string;
  desc: string;
}

// 模块级常量：迁移范围与顺序固定，避免每次渲染重建数组
const SCOPE_META: ScopeMeta[] = [
  {
    key: "todo",
    icon: <CheckSquareOutlined />,
    title: "待办清单",
    desc: "全部待办与子项，含完成状态、备注、工时",
  },
  {
    key: "memo",
    icon: <EditOutlined />,
    title: "备忘笔记",
    desc: "memos 目录下的全部 Markdown 备忘文件",
  },
];

export default function MigrationPage() {
  const { scopes, toggleScope, exporting, importing, busy, feedback, runExport, runImport } =
    useMigration();

  return (
    <Page>
      <div className="migration-page">
        <header className="migration-page__head">
          <h1 className="migration-page__title">数据迁移</h1>
          <p className="migration-page__subtitle">
            勾选要迁移的数据：导出会打包成一个 zip 备份包；导入会选择一个备份包，把数据追加合并到当前账号。
          </p>
        </header>

        <div className="migration-page__grid">
          {SCOPE_META.map((meta) => (
            <MigrationScopeCard
              key={meta.key}
              icon={meta.icon}
              title={meta.title}
              desc={meta.desc}
              active={scopes.includes(meta.key)}
              onToggle={() => toggleScope(meta.key)}
            />
          ))}
        </div>

        <MigrationActions
          exporting={exporting}
          importing={importing}
          canExport={scopes.length > 0}
          onExport={runExport}
          onImport={runImport}
        />

        {feedback ? (
          <Alert
            className="migration-page__feedback"
            type={feedback.type}
            showIcon
            message={feedback.text}
          />
        ) : null}

        <p className="migration-page__hint">
          导入为追加合并：待办会重新分配编号并保持父子结构，备忘重名时自动追加序号，不会覆盖已有数据。
        </p>

        <p className="migration-page__hint is-muted">
          {busy ? "正在处理，请勿关闭窗口…" : "备份包内含 manifest.json 清单，导入前会校验来源与版本。"}
        </p>
      </div>
    </Page>
  );
}
