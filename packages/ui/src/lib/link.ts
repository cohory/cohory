"use client";

import {
  createContext,
  createElement,
  useContext,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
};

type LinkComponent = "a" | ComponentType<LinkProps>;

const LinkContext = createContext<LinkComponent>("a");

function LinkProvider({ component, children }: { component: LinkComponent; children: ReactNode }) {
  return createElement(LinkContext.Provider, { value: component }, children);
}

function Link(props: LinkProps) {
  return createElement(useContext(LinkContext), props);
}

export { Link, LinkProvider, type LinkComponent, type LinkProps };
