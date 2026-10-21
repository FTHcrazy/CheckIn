/**
 * 「新建关系」二次确认弹层（S3 / W-13）
 *
 * 产品口径：拖线容易松手在错误卡片上，所以在真正写库之前，必须把**将要写入
 * 什么**逐项摆出来 —— 起点、终点、关系名原文、重复判定、目标作品。
 * 缺任一项都算没通过验收（这五项就是 W-13 的全部内容）。
 *
 * 失败态的处理与别处不同：**弹层不关、内容不清空、按钮保持可点**。
 * 「确认了但没生效」必须被看见，最差的做法是关框 + toast（用户以为成功了）。
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, AutoComplete, Button, Input, Modal } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { checkDraft, type DraftEndpoint } from "../../utils/relation-draft";
import "./index.scss";

/** 关系名上限：一句话能写清楚的长度，超出就是备注而不是关系名 */
export const RELATION_NAME_MAX = 24;

export interface RelationCreateDialogProps {
  open: boolean;
  source: DraftEndpoint | null;
  target: DraftEndpoint | null;
  /** 同一对端点已存在的关系名（正反向都算） */
  existingRelations: readonly string[];
  /** 本书出现过的全部关系名（输入框候选，可自由输入新名） */
  knownRelations: readonly string[];
  /** 写入目标作品名（第 5 项） */
  workName: string;
  submitting: boolean;
  /** 上一次提交的失败原因（框不关） */
  error: string | null;
  /** 画布在别处改过 → 需要重新载入 */
  stale: boolean;
  /** 取消（带回当前输入：埋点要区分「取消」与「校验阻断」） */
  onCancel: (relation: string, merge: boolean) => void;
  onSubmit: (relation: string, merge: boolean) => void;
  /** 点了确认但校验没过（关系名为空等）：只为埋点，UI 上按钮本来就是禁用的 */
  onBlocked?: (relation: string, merge: boolean) => void;
  onReload: () => void;
}

function EndpointRow({ label, endpoint }: { label: string; endpoint: DraftEndpoint | null }) {
  return (
    <div className="rel-create__row">
      <span className="rel-create__label">{label}</span>
      <span className="rel-create__value">
        {endpoint ? (
          <>
            <span className="rel-create__name" title={endpoint.name}>
              {endpoint.name}
            </span>
            <span className="rel-create__type">{endpoint.typeLabel}</span>
          </>
        ) : (
          <span className="rel-create__muted">—</span>
        )}
      </span>
    </div>
  );
}

export default function RelationCreateDialog({
  open,
  source,
  target,
  existingRelations,
  knownRelations,
  workName,
  submitting,
  error,
  stale,
  onCancel,
  onSubmit,
  onBlocked,
  onReload,
}: RelationCreateDialogProps) {
  const [relation, setRelation] = useState("");

  // 每次重新打开都从空开始：上一次的内容留着会让「连点确认」变成「连点同一句」
  useEffect(() => {
    if (open) setRelation("");
  }, [open, source?.id, target?.id]);

  const check = useMemo(
    () =>
      source && target
        ? checkDraft({ source, target, relation }, { existingRelations })
        : null,
    [source, target, relation, existingRelations],
  );

  const submit = () => {
    if (submitting) return;
    if (!check?.canSubmit) {
      // 按钮此时是禁用的，能走到这里只有「回车」这一条路：记一条 blocked，
      // 否则用户会以为「按了没反应」是 bug
      onBlocked?.(relation, check?.merge ?? false);
      return;
    }
    onSubmit(check.relation, check.merge);
  };

  const cancel = () => {
    onCancel(relation, check?.merge ?? false);
  };

  const options = useMemo(
    () => knownRelations.map((name) => ({ value: name })),
    [knownRelations],
  );

  return (
    <Modal
      open={open}
      title="新建关系"
      className="rel-create-modal"
      width={420}
      centered
      zIndex={1200}
      mask={{ closable: false }}
      keyboard={!submitting}
      onCancel={cancel}
      footer={[
        <Button key="cancel" autoInsertSpace={false} onClick={cancel} disabled={submitting}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          autoInsertSpace={false}
          loading={submitting}
          disabled={!check?.canSubmit}
          onClick={submit}
        >
          创建关系
        </Button>,
      ]}
    >
      <div className="rel-create">
        <EndpointRow label="起点" endpoint={source} />
        <div className="rel-create__arrow" aria-hidden>
          <ArrowRightOutlined />
        </div>
        <EndpointRow label="终点" endpoint={target} />

        <div className="rel-create__row rel-create__row--input">
          <span className="rel-create__label">关系名</span>
          <div className="rel-create__value">
            {/* 子节点用真正的 Input：占位文案与 maxLength 才会落到 input 上
                （AutoComplete 自己渲染的搜索框不带这两个属性，也无法被读屏读到） */}
            <AutoComplete
              value={relation}
              options={options}
              onChange={(value: string) => setRelation(value.slice(0, RELATION_NAME_MAX))}
            >
              <Input
                placeholder="例如：师徒 / 宿敌 / 出身"
                aria-label="关系名"
                maxLength={RELATION_NAME_MAX}
                // 输入框在弹层打开时就要拿到焦点：用户刚拖完线，下一步就是打字
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </AutoComplete>
            {check?.issues.map((issue) => (
              <p
                key={issue.code}
                className={`rel-create__hint rel-create__hint--${issue.fatal ? "error" : "warn"}`}
              >
                {issue.message}
                {issue.code === "duplicate" ? "（继续提交会并入这条边）" : ""}
              </p>
            ))}
            {!check?.issues.length && (
              <p className="rel-create__hint rel-create__hint--muted">
                关系名必填；同一对要素可以有多条不同关系。
              </p>
            )}
          </div>
        </div>

        <div className="rel-create__row">
          <span className="rel-create__label">重复判定</span>
          <span className="rel-create__value">
            <b className={`rel-create__verdict${check?.merge ? " is-merge" : ""}`}>
              {check?.verdict ?? "—"}
            </b>
          </span>
        </div>

        <div className="rel-create__row">
          <span className="rel-create__label">写入</span>
          <span className="rel-create__value">
            《{workName || "当前作品"}》
            <span className="rel-create__muted">（数据不出本书）</span>
          </span>
        </div>

        {error && (
          <Alert
            className="rel-create__error"
            type="error"
            showIcon
            message={error}
            action={
              stale ? (
                <Button size="small" onClick={onReload}>
                  重新载入
                </Button>
              ) : null
            }
          />
        )}
      </div>
    </Modal>
  );
}
