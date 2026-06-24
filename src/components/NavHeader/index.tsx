import { ArrowLeftOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import "./index.scss";

export default function NavHeader() {
  const navigate = useNavigate();
  return (
    <div className="nav-header">
      <ArrowLeftOutlined
        className="nav-header-icon"
        onClick={() => navigate(-1)}
      />
    </div>
  );
}
