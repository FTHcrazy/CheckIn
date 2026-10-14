import { useMemo, useState } from "react";
import { Button, Collapse, Empty, Input, Modal, Tabs } from "antd";
import { RedoOutlined, SearchOutlined } from "@ant-design/icons";
import { HELP_COPY } from "@/shared/novel/guide-copy";
import {
  searchHelpDoc,
  type HelpDoc,
  type HelpHit,
} from "@/shared/novel/guide-doc";
import "./index.scss";

/**
 * 帮助中心（L3 常驻入口）
 *
 * 为什么做成通用壳 + 文档数据由 props 注入：NovelWindow 与 PackWindow 两个窗口
 * 都要常驻帮助入口，但行囊窗口没有 Tour，「重看新手引导」按钮不该出现在那里。
 * 壳放 shared、文档数据（novel 域）留在使用方传入，避免 shared 组件反向依赖业务域。
 *
 * 引导是一次性的，帮助是长期的：任何被 Tour 讲过的动作，这里都必须能检索到。
 */

export interface HelpCenterProps {
  open: boolean;
  doc: HelpDoc;
  onClose: () => void;
  /** 重看新手引导；不传则不渲染该按钮（如行囊窗口） */
  onReplayGuide?: () => void;
  /** 引导是否已走完：走完时按钮文案变为「再看一次」 */
  guideDone?: boolean;
}

export default function HelpCenter({
  open,
  doc,
  onClose,
  onReplayGuide,
  guideDone = false,
}: HelpCenterProps) {
  const [keyword, setKeyword] = useState("");

  // 关闭后重置搜索：下次打开直接回到首屏，不残留上次的检索词
  const hits = useMemo<HelpHit[]>(
    () => (open ? searchHelpDoc(doc, keyword) : []),
    [doc, keyword, open],
  );
  const searching = keyword.trim().length > 0;

  const flowTab = (
    <ol className="help-center__flow">
      {doc.flow.map((step) => (
        <li key={step.step} className="help-center__flow-item">
          <span className="help-center__flow-num">{step.step}</span>
          <div className="help-center__flow-body">
            <div className="help-center__flow-title">{step.title}</div>
            <div className="help-center__flow-desc">{step.action}</div>
          </div>
        </li>
      ))}
    </ol>
  );

  const indexTab = (
    <div className="help-center__groups">
      {doc.sections.map((section) => (
        <section key={section.id} className="help-center__group">
          <h4 className="help-center__group-title">{section.title}</h4>
          <dl className="help-center__list">
            {section.entries.map((entry) => (
              <div key={entry.term} className="help-center__row">
                <dt className="help-center__term">{entry.term}</dt>
                <dd className="help-center__desc">{entry.desc}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );

  const faqTab = (
    <Collapse
      items={doc.faq.map((item) => ({
        key: item.id,
        label: item.q,
        children: <p className="help-center__answer">{item.a}</p>,
      }))}
    />
  );

  const keysTab = (
    <dl className="help-center__list">
      {doc.shortcuts.map((item) => (
        <div key={item.term} className="help-center__row">
          <dt className="help-center__term help-center__term--key">
            <kbd>{item.term}</kbd>
          </dt>
          <dd className="help-center__desc">{item.desc}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <Modal
      className="help-center"
      classNames={{ body: "help-center__body" }}
      open={open}
      onCancel={onClose}
      footer={null}
      width={880}
      centered
      destroyOnHidden
      title={HELP_COPY.title}
    >
      {onReplayGuide ? (
        <div className="help-center__top">
          <Button type="primary" icon={<RedoOutlined />} onClick={onReplayGuide}>
            {guideDone ? "再看一次新手引导" : HELP_COPY.replay}
          </Button>
          <span className="help-center__hint">{HELP_COPY.replayHint}</span>
        </div>
      ) : null}

      <Input
        className="help-center__search"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={HELP_COPY.searchPlaceholder}
        prefix={<SearchOutlined />}
        allowClear
      />

      {searching ? (
        hits.length > 0 ? (
          <ul className="help-center__hits">
            {hits.map((hit, index) => (
              <li key={`${hit.kind}-${index}`} className="help-center__hit">
                <span className="help-center__hit-group">{hit.group}</span>
                <div className="help-center__hit-title">{hit.title}</div>
                <div className="help-center__hit-detail">{hit.detail}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            className="help-center__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={HELP_COPY.searchEmpty}
          />
        )
      ) : (
        <Tabs
          className="help-center__tabs"
          items={[
            { key: "flow", label: "快速上手", children: flowTab },
            { key: "index", label: "功能索引", children: indexTab },
            { key: "faq", label: "常见问题", children: faqTab },
            { key: "keys", label: "快捷键", children: keysTab },
          ]}
        />
      )}
    </Modal>
  );
}
