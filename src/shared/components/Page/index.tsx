import React from "react";
import NavHeader from "../NavHeader";
import "./index.scss";

interface PageProps {
  children?: React.ReactNode;
}
export default function Page(props: PageProps) {
  return (
    <div className="page">
      <NavHeader />
      {props.children}
    </div>
  );
}
