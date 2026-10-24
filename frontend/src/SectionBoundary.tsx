import { Component, type ReactNode } from "react";
import { Button } from "./UI";

/** Navigation stays available if a section fails, including an outdated split bundle. */
export class SectionBoundary extends Component<{children:ReactNode; refresh:()=>void}, {failed:boolean}> {
  state = {failed:false};

  static getDerivedStateFromError() {return {failed:true};}

  render() {
    if (this.state.failed) return <section className="panel section-failure" role="alert">
      <h1>Не удалось открыть раздел</h1>
      <p>Возможно, приложение обновилось или соединение прервалось. Обновите приложение или выберите другой раздел в меню.</p>
      <Button onClick={this.props.refresh}>Обновить приложение</Button>
    </section>;
    return this.props.children;
  }
}
