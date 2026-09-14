import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useNavigate } from "react-router-dom";

import "./index.scss";

export default function NavHeader() {
  const navigate = useNavigate();

  return (
    <div className="nav-header">
      <div className="nav-header-inner">
        <Button
          className="nav-header-icon"
          type="text"
          onClick={() => navigate(-1)}
          icon={<ArrowLeftOutlined />}
        >
          返回
        </Button>
      </div>
    </div>
  );
}
