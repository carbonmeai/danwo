import { styled } from "@danwo/ui/jsx"

import type { IconProps } from "../icons/types"

export const Lists = styled((props: IconProps) => {
  const { className = "", size, width, height, ...restProps } = props

  return (
    <svg
      className={`empty-state-illustration ${className}`}
      fill="none"
      height={size || height || 80}
      viewBox="0 0 80 80"
      width={size || width || 80}
      xmlns="http://www.w3.org/2000/svg"
      {...restProps}
    >
      <g filter="url(#filter0_d_403_38034)">
        <path
          d="M6.66211 37.9994C6.66211 34.1385 7.46789 33.3327 11.3288 33.3327H68.6621C72.523 33.3327 73.3288 34.1385 73.3288 37.9994V41.9994C73.3288 45.8603 72.523 46.666 68.6621 46.666H11.3288C7.46789 46.666 6.66211 45.8603 6.66211 41.9994V37.9994Z"
          fill="transparent"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
        <path
          d="M6.66211 11.3328C6.66211 7.47192 7.46789 6.66614 11.3288 6.66614H68.6621C72.523 6.66614 73.3288 7.47192 73.3288 11.3328V15.3328C73.3288 19.1937 72.523 19.9995 68.6621 19.9995H11.3288C7.46789 19.9995 6.66211 19.1937 6.66211 15.3328V11.3328Z"
          fill="transparent"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
        <path
          d="M6.66211 64.6659C6.66211 60.805 7.46789 59.9993 11.3288 59.9993H68.6621C72.523 59.9993 73.3288 60.805 73.3288 64.6659V68.6659C73.3288 72.5268 72.523 73.3326 68.6621 73.3326H11.3288C7.46789 73.3326 6.66211 72.5268 6.66211 68.6659V64.6659Z"
          fill="transparent"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </g>
    </svg>
  )
})
