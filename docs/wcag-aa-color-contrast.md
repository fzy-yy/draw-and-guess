# WCAG AA 颜色对比基线

客户端继续使用 Navy / Blue / Paper / Yellow 品牌基色。黄色和绿色优先承担底色、图标与装饰；在浅色表面承载文字或关键图形时，分别使用集中定义的 `warning-fg` 与 `success-fg`。深色顶栏使用 `success-on-dark`、`danger-on-dark`。

| 典型组合                             |      修改前 |      修改后 |                 门槛 |
| ------------------------------------ | ----------: | ----------: | -------------------: |
| muted / white                        |      4.76:1 |      7.58:1 |                4.5:1 |
| muted / paper                        |      4.55:1 |      7.24:1 |                4.5:1 |
| muted / sky                          |      3.90:1 |      6.21:1 |                4.5:1 |
| muted / line                         |      3.21:1 |      5.10:1 |                4.5:1 |
| blue / sky                           |      4.24:1 |      5.49:1 |                4.5:1 |
| success text / white                 |      3.30:1 |      7.13:1 |                4.5:1 |
| success text / paper                 |      3.15:1 |      6.81:1 |                4.5:1 |
| warning text or icon / light surface | 1.32–1.53:1 | 5.92–6.85:1 | 3:1 图形；4.5:1 文字 |
| connected text / tinted navy         |      3.70:1 |      6.99:1 |                4.5:1 |
| disconnected text / tinted navy      |      2.85:1 |      4.98:1 |                4.5:1 |
| line control border / white          |      1.48:1 |      4.76:1 |                  3:1 |
| yellow focus indicator / paper       |      1.46:1 |      3.52:1 |                  3:1 |

比值由 `test/unit/color-contrast.spec.ts` 直接读取 `tokens.css` 后按 WCAG 相对亮度公式计算。测试覆盖普通文字、深色顶栏状态、图标、控件边界与焦点指示器，避免后续仅凭肉眼调整令牌造成回退。
