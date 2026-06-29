import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useNavigate } from "react-router-dom";

import "./index.scss";

export default function NavHeader() {
  const navigate = useNavigate();
  return (
    <div className="nav-header">
      <Button
        className="nav-header-icon"
        onClick={() => navigate(-1)}
        icon={<ArrowLeftOutlined />}
      >
        返回
      </Button>
    </div>
  );
}
