import type { StyledComponent } from "@danwo/ui/types"
import type { JSX, SVGProps } from "react"

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: string | number
}

export type TIcon = StyledComponent<(props: IconProps) => JSX.Element>
