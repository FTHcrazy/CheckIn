import React, { useEffect } from "react";
import Page from "../../components/Page";
import "./index.scss";
import { Card } from "antd";

export default function CanvansPage() {
  const init = () => {
    const canvas = document.getElementById("tutorial") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(75, 75, 50, 0, Math.PI * 2, true); // 绘制
    // ctx.moveTo(110, 75);
    ctx.arc(75, 75, 35, 0, Math.PI, false); // 口 (顺时针)
    // ctx.moveTo(65, 65);
    ctx.arc(60, 65, 5, 0, Math.PI * 2, true); // 左眼
    // ctx.moveTo(95, 65);
    ctx.arc(90, 65, 5, 0, Math.PI * 2, true); // 右眼
    ctx.stroke();
  };

  useEffect(() => {
    init();
  }, []);

  return (
    <Page>
      <div className="canvans-page-container">
        <Card>
          <canvas id="tutorial" width={200} height={150}></canvas>
        </Card>
      </div>
    </Page>
  );
}
