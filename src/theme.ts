import type { ThemeConfig } from "antd";

export const colors = {
  canvas: "#F6F4EF",
  surface: "#FFFFFF",
  ink: "#1C1917",
  muted: "#78716C",
  primary: "#3D6B4F",
  primarySoft: "#E8F0EA",
  positive: "#3D6B4F",
  negative: "#B42318",
  warning: "#B45309",
  gold: "#C4A574",
  border: "#E7E2D8",
  borderStrong: "#D9D2C5",
} as const;

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorSuccess: colors.positive,
    colorError: colors.negative,
    colorWarning: colors.warning,
    colorInfo: colors.primary,
    colorBgLayout: colors.canvas,
    colorBgContainer: colors.surface,
    colorText: colors.ink,
    colorTextSecondary: colors.muted,
    colorBorder: colors.border,
    colorBorderSecondary: "#EFEBE3",
    colorLink: colors.primary,
    borderRadius: 12,
    borderRadiusLG: 16,
    fontFamily: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    controlHeight: 36,
    boxShadow: "0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px rgba(28, 25, 23, 0.04)",
    boxShadowSecondary: "0 1px 2px rgba(28, 25, 23, 0.04)",
  },
  components: {
    Layout: {
      siderBg: colors.canvas,
      bodyBg: colors.canvas,
      headerBg: "transparent",
      triggerBg: colors.canvas,
    },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: colors.primarySoft,
      itemSelectedColor: colors.primary,
      itemHoverBg: "rgba(61, 107, 79, 0.06)",
      itemHoverColor: colors.ink,
      itemColor: "#44403C",
      groupTitleColor: "#A8A29E",
      itemBorderRadius: 10,
      itemMarginInline: 10,
      iconSize: 16,
    },
    Card: {
      borderRadiusLG: 16,
      paddingLG: 20,
    },
    Button: {
      borderRadius: 10,
      primaryShadow: "none",
    },
    Table: {
      headerBg: "#FAF8F4",
      headerColor: colors.muted,
      rowHoverBg: "#F8F6F1",
      headerSplitColor: "transparent",
      borderColor: colors.border,
      cellPaddingBlockMD: 12,
      cellPaddingInlineMD: 16,
      cellFontSizeMD: 13,
      footerBg: colors.surface,
    },
    Drawer: {
      paddingLG: 24,
    },
    Tag: {
      defaultBg: colors.primarySoft,
      defaultColor: colors.primary,
    },
    Alert: {
      borderRadiusLG: 12,
    },
  },
};
