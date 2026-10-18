import { styled } from "@danwo/ui/jsx"

import type { IconProps } from "../icons/types"

export const Reports = styled((props: IconProps) => {
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
      <g filter="url(#filter0_d_403_38015)">
        <path
          d="M34.9993 66.3333V13.6666C34.9993 8.66663 32.866 6.66663 27.566 6.66663H14.0993C8.79935 6.66663 6.66602 8.66663 6.66602 13.6666V66.3333C6.66602 71.3333 8.79935 73.3333 14.0993 73.3333H27.566C32.866 73.3333 34.9993 71.3333 34.9993 66.3333Z"
          fill="transparent"
        />
        <path
          d="M34.9993 66.3333V13.6666C34.9993 8.66663 32.866 6.66663 27.566 6.66663H14.0993C8.79935 6.66663 6.66602 8.66663 6.66602 13.6666V66.3333C6.66602 71.3333 8.79935 73.3333 14.0993 73.3333H27.566C32.866 73.3333 34.9993 71.3333 34.9993 66.3333Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </g>
      <g filter="url(#filter1_d_403_38015)">
        <path
          d="M73.3333 28.4V13.2666C73.3333 8.56663 71.2 6.66663 65.9 6.66663H52.4333C47.1333 6.66663 45 8.56663 45 13.2666V28.3666C45 33.1 47.1333 34.9666 52.4333 34.9666H65.9C71.2 35 73.3333 33.1 73.3333 28.4Z"
          fill="transparent"
        />
        <path
          d="M73.3333 28.4V13.2666C73.3333 8.56663 71.2 6.66663 65.9 6.66663H52.4333C47.1333 6.66663 45 8.56663 45 13.2666V28.3666C45 33.1 47.1333 34.9666 52.4333 34.9666H65.9C71.2 35 73.3333 33.1 73.3333 28.4Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </g>
      <g filter="url(#filter2_d_403_38015)">
        <path
          d="M73.3333 65.9V52.4333C73.3333 47.1333 71.2 45 65.9 45H52.4333C47.1333 45 45 47.1333 45 52.4333V65.9C45 71.2 47.1333 73.3333 52.4333 73.3333H65.9C71.2 73.3333 73.3333 71.2 73.3333 65.9Z"
          fill="transparent"
        />
        <path
          d="M73.3333 65.9V52.4333C73.3333 47.1333 71.2 45 65.9 45H52.4333C47.1333 45 45 47.1333 45 52.4333V65.9C45 71.2 47.1333 73.3333 52.4333 73.3333H65.9C71.2 73.3333 73.3333 71.2 73.3333 65.9Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </g>
    </svg>
  )
})
