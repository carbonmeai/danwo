import { styled } from "@danwo/ui/jsx"

import type { IconProps } from "../icons/types"

export const Company = styled((props: IconProps) => {
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
      <g filter="url(#filter0_d_403_37978)">
        <path
          d="M22.3327 60H13.8328C9.0661 60 6.66602 57.5999 6.66602 52.8333V13.8334C6.66602 9.06677 9.0661 6.66669 13.8328 6.66669H28.1661C32.9327 6.66669 35.3326 9.06677 35.3326 13.8334V20"
          fill="transparent"
        />
        <path
          d="M22.3327 60H13.8328C9.0661 60 6.66602 57.5999 6.66602 52.8333V13.8334C6.66602 9.06677 9.0661 6.66669 13.8328 6.66669H28.1661C32.9327 6.66669 35.3326 9.06677 35.3326 13.8334V20"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeMiterlimit="10"
          strokeWidth="2"
        />
      </g>
      <g filter="url(#filter1_d_403_37978)">
        <path
          d="M44.666 20V13.8334C44.666 9.06677 47.0659 6.66669 51.8326 6.66669H66.1659C70.9325 6.66669 73.3326 9.06677 73.3326 13.8334V52.8333C73.3326 57.5999 70.9325 60 66.1659 60H57.8993"
          fill="transparent"
        />
        <path
          d="M44.666 20V13.8334C44.666 9.06677 47.0659 6.66669 51.8326 6.66669H66.1659C70.9325 6.66669 73.3326 9.06677 73.3326 13.8334V52.8333C73.3326 57.5999 70.9325 60 66.1659 60H57.8993"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeMiterlimit="10"
          strokeWidth="2"
        />
      </g>
      <g filter="url(#filter2_d_403_37978)">
        <path
          d="M57.8986 28.0666V65.2667C57.8986 70.6334 55.2321 73.3333 49.8654 73.3333H30.3986C25.032 73.3333 22.332 70.6334 22.332 65.2667V28.0666C22.332 22.6999 25.032 20 30.3986 20H49.8654C55.2321 20 57.8986 22.6999 57.8986 28.0666Z"
          fill="transparent"
        />
        <path
          d="M57.8986 28.0666V65.2667C57.8986 70.6334 55.2321 73.3333 49.8654 73.3333H30.3986C25.032 73.3333 22.332 70.6334 22.332 65.2667V28.0666C22.332 22.6999 25.032 20 30.3986 20H49.8654C55.2321 20 57.8986 22.6999 57.8986 28.0666Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeMiterlimit="10"
          strokeWidth="2"
        />
      </g>
      <path
        d="M33.334 36.6667H46.6673"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeMiterlimit="10"
        strokeWidth="2"
      />
      <path
        d="M33.334 46.6667H46.6673"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeMiterlimit="10"
        strokeWidth="2"
      />
      <path
        d="M40 73.3333V63.3333"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeMiterlimit="10"
        strokeWidth="4"
      />
    </svg>
  )
})
