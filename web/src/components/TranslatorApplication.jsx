"use client"
import React, { useEffect, useRef, useState } from 'react'
import {
  Button,
  Input,
  Card,
  Textarea,
  Slider,
  CardHeader,
  CardBody,
  Divider,
  Select,
  SelectItem
} from "@nextui-org/react";

import { FileUploadButton } from '@/components/FileUploadButton';
import { SubtitleCard } from '@/components/SubtitleCard';
import { downloadString } from '@/utils/download';
import { sampleSrt } from '@/data/sample';

import {
  subtitleParser
} from "chatgpt-subtitle-translator/src/browser.mjs"

const RATE_LIMIT = "RATE_LIMIT"
const MODEL = "MODEL"

export function TranslatorApplication() {
  // Translator Configuration
  const [fromLanguage, setFromLanguage] = useState("")
  const [toLanguage, setToLanguage] = useState("Traditional Chinese")
  const [systemInstruction, setSystemInstruction] = useState("")
  const [model, setModel] = useState("")
  const [batchSizes, setBatchSizes] = useState([10, 50])
  const [rateLimit, setRateLimit] = useState(60)

  // ChatGPT OAuth State
  const [chatGPTStatus, setChatGPTStatus] = useState(null)
  const [chatGPTModels, setChatGPTModels] = useState([])
  const [chatGPTAuthLoading, setChatGPTAuthLoading] = useState(true)
  const [chatGPTAuthError, setChatGPTAuthError] = useState("")

  // Translator State
  const [srtInputText, setSrtInputText] = useState(sampleSrt)
  const [srtOutputText, setSrtOutputText] = useState(sampleSrt)
  const [inputFileName, setInputFileName] = useState("sample.srt")
  const [inputs, setInputs] = useState(
    subtitleParser.fromSrt(sampleSrt).map(x => x.text)
  )
  const [outputs, setOutput] = useState([])
  const [streamOutput, setStreamOutput] = useState("")
  const [translatorRunningState, setTranslatorRunningState] = useState(false)
  const requestAbortControllerRef = useRef(null)

  // Translator Stats
  const [usageInformation, setUsageInformation] = useState(null)
  const [RPMInfomation, setRPMInformation] = useState(0)

  async function loadChatGPTModels(preferredModel) {
    const response = await fetch("/api/chatgpt/models", {
      cache: "no-store",
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.error ?? "Failed to load ChatGPT models")
    }

    const models = Array.isArray(data.models) ? data.models : []
    setChatGPTModels(models)

    const selected =
      models.find(x => x.slug === preferredModel) ??
      models.find(x => x.slug === "gpt-5.6-sol") ??
      models.find(x => x.slug.endsWith("-sol")) ??
      models[0]

    if (selected) {
      setModelValue(selected.slug)
    }
    else {
      setModel("")
    }
  }

  async function refreshChatGPTStatus() {
    setChatGPTAuthLoading(true)
    setChatGPTAuthError("")

    try {
      const response = await fetch("/api/chatgpt/status", {
        cache: "no-store",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load ChatGPT status")
      }

      setChatGPTStatus(data)

      if (data.connected) {
        await loadChatGPTModels(localStorage.getItem(MODEL) ?? undefined)
      }
      else {
        setChatGPTModels([])
        setModel("")
      }
    }
    catch (error) {
      console.error("[User Interface] ChatGPT status error", error)
      setChatGPTAuthError(error?.message ?? String(error))
      setChatGPTStatus(null)
      setChatGPTModels([])
      setModel("")
    }
    finally {
      setChatGPTAuthLoading(false)
    }
  }

  async function connectChatGPT() {
    setChatGPTAuthLoading(true)
    setChatGPTAuthError("")

    try {
      const response = await fetch("/api/chatgpt/login", {
        method: "POST",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error ?? "ChatGPT login failed")
      }

      await refreshChatGPTStatus()
    }
    catch (error) {
      console.error("[User Interface] ChatGPT login error", error)
      setChatGPTAuthError(error?.message ?? String(error))
      setChatGPTAuthLoading(false)
    }
  }

  async function disconnectChatGPT() {
    if (translatorRunningState) {
      stopGeneration()
    }

    setChatGPTAuthLoading(true)
    setChatGPTAuthError("")

    try {
      const response = await fetch("/api/chatgpt/logout", {
        method: "POST",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error ?? "ChatGPT logout failed")
      }

      setChatGPTModels([])
      setModel("")
      await refreshChatGPTStatus()
    }
    catch (error) {
      console.error("[User Interface] ChatGPT logout error", error)
      setChatGPTAuthError(error?.message ?? String(error))
      setChatGPTAuthLoading(false)
    }
  }

  // Persistent Data Restoration
  useEffect(() => {
    setRateLimit(Number(localStorage.getItem(RATE_LIMIT) ?? 60))
    refreshChatGPTStatus()

    return () => {
      requestAbortControllerRef.current?.abort()
    }
  }, [])

  /**
   * @param {string} value
   */
  function setRateLimitValue(value) {
    localStorage.setItem(RATE_LIMIT, value)
    setRateLimit(Number(value))
  }

  /**
   * @param {string | undefined} value
   */
  function setModelValue(value) {
    if (!value) {
      localStorage.removeItem(MODEL)
      setModel("")
      return
    }

    localStorage.setItem(MODEL, value)
    setModel(value)
  }

  async function generate(e) {
    e.preventDefault()

    if (!chatGPTStatus?.connected) {
      alert("Connect ChatGPT before starting translation.")
      return
    }

    if (!model) {
      alert("Select a ChatGPT model first.")
      return
    }

    if (inputs.length === 0) {
      alert("Import an SRT file with at least one subtitle.")
      return
    }

    console.log("[User Interface]", "Begin OAuth backend generation")

    setTranslatorRunningState(true)
    setOutput([])
    setUsageInformation(null)
    setRPMInformation(0)
    setStreamOutput("Translating on localhost backend...")

    const controller = new AbortController()
    requestAbortControllerRef.current = controller

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          lines: inputs,
          fromLanguage,
          toLanguage,
          systemInstruction,
          model,
          batchSizes,
          rateLimit,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error ?? "Translation failed")
      }

      const translatedLines = Array.isArray(data.outputs)
        ? data.outputs
        : []

      if (translatedLines.length !== inputs.length) {
        throw new Error(
          `Translation line count mismatch: expected ${inputs.length}, got ${translatedLines.length}.`
        )
      }

      const outputWorkingProgress = subtitleParser.fromSrt(srtInputText)

      translatedLines.forEach((line, index) => {
        if (outputWorkingProgress[index]) {
          outputWorkingProgress[index].text = line
        }
      })

      setOutput(translatedLines)
      setSrtOutputText(subtitleParser.toSrt(outputWorkingProgress))
      setUsageInformation(data.usage ?? null)
      setRPMInformation(data.rpm ?? 0)
      setStreamOutput("")
    }
    catch (error) {
      if (error?.name === "AbortError") {
        console.log("[User Interface]", "Translation aborted")
        setStreamOutput("")
      }
      else {
        console.error(error)
        setStreamOutput("")
        alert(error?.message ?? error)
      }
    }
    finally {
      requestAbortControllerRef.current = null
      setTranslatorRunningState(false)
    }
  }

  function stopGeneration() {
    console.log("[User Interface]", "Aborting")
    requestAbortControllerRef.current?.abort()
    requestAbortControllerRef.current = null
    setStreamOutput("")
    setTranslatorRunningState(false)
  }

  async function exportSrtFile() {
    const baseName =
      inputFileName.replace(/\.srt$/i, "") ||
      "subtitle"

    const languageTag =
      toLanguage
        .trim()
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "_")
        .replace(/^_+|_+$/g, "") ||
      "translated"

    const suggestedName =
      `${baseName}.${languageTag}.srt`

    if (
      typeof window !== "undefined" &&
      "showSaveFilePicker" in window
    ) {
      try {
        const handle =
          await window.showSaveFilePicker({
            suggestedName,
            types: [
              {
                description: "SubRip Subtitle",
                accept: {
                  "application/x-subrip": [".srt"],
                  "text/plain": [".srt"],
                },
              },
            ],
          })

        const writable =
          await handle.createWritable()

        await writable.write(
          srtOutputText
        )

        await writable.close()
        return
      }
      catch (error) {
        if (
          error?.name ===
          "AbortError"
        ) {
          return
        }

        console.warn(
          "[User Interface] Save picker unavailable, falling back to download",
          error
        )
      }
    }

    downloadString(
      srtOutputText,
      "text/plain",
      suggestedName
    )
  }

  return (
    <>
      <div className='w-full'>
        <form id="translator-config-form" onSubmit={(e) => generate(e)}>
          <div className='px-4 pt-4 flex flex-wrap justify-between w-full gap-4'>
            <Card className="z-10 w-full shadow-md border" shadow="none">
              <CardHeader className="flex justify-between gap-3 pb-0">
                <div className="flex flex-col">
                  <p className="text-md">ChatGPT Account</p>
                  <p className="text-small text-default-500">
                    OAuth credentials stay in the local Node.js backend.
                  </p>
                </div>
              </CardHeader>

              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    {chatGPTAuthLoading ? (
                      <p className="text-small text-default-500">
                        Checking ChatGPT connection...
                      </p>
                    ) : chatGPTStatus?.connected ? (
                      <>
                        <p className="text-small text-success">
                          ● Connected
                        </p>
                        <p className="text-small">
                          {chatGPTStatus.email ?? "ChatGPT account"}
                        </p>
                        <p className="text-tiny text-default-500">
                          Plan usage: {chatGPTStatus.planUsage ? "enabled" : "disabled"}
                          {typeof chatGPTStatus.expiresInSeconds === "number"
                            ? ` · access token expires in ${chatGPTStatus.expiresInSeconds}s`
                            : ""}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-small text-default-500">
                          ○ Not connected
                        </p>
                        <p className="text-tiny text-default-500">
                          Connect your ChatGPT account to load plan models.
                        </p>
                      </>
                    )}

                    {chatGPTAuthError && (
                      <p className="text-small text-danger">
                        {chatGPTAuthError}
                      </p>
                    )}
                  </div>

                  {chatGPTStatus?.connected ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        as="a"
                        href="https://chatgpt.com/settings/usage"
                        target="_blank"
                        rel="noreferrer"
                        variant="flat"
                        type="button"
                      >
                        Manage usage
                      </Button>

                      <Button
                        color="danger"
                        variant="flat"
                        onClick={disconnectChatGPT}
                        isLoading={chatGPTAuthLoading}
                        type="button"
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      color="primary"
                      onClick={connectChatGPT}
                      isLoading={chatGPTAuthLoading}
                      type="button"
                    >
                      Continue with ChatGPT
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card className="z-10 w-full shadow-md border" shadow="none">
              <CardHeader className="flex gap-3 pb-0">
                <div className="flex flex-col">
                  <p className="text-md">Translation</p>
                </div>
              </CardHeader>

              <CardBody>
                <div className='flex flex-wrap justify-between w-full gap-4'>
                  <div className='flex w-full gap-4'>
                    <Input
                      className='w-full md:w-6/12'
                      size='sm'
                      type="text"
                      label="From Language"
                      placeholder="Auto"
                      autoComplete='on'
                      value={fromLanguage}
                      onValueChange={setFromLanguage}
                    />

                    <Input
                      className='w-full md:w-6/12'
                      size='sm'
                      type="text"
                      label="To Language"
                      autoComplete='on'
                      value={toLanguage}
                      onValueChange={setToLanguage}
                    />
                  </div>

                  <div className='w-full'>
                    <Textarea
                      label="System Instruction"
                      minRows={2}
                      description="Override preset system instruction"
                      placeholder={`Translate ${fromLanguage ? fromLanguage + " " : ""}to ${toLanguage}`}
                      value={systemInstruction}
                      onValueChange={setSystemInstruction}
                    />
                  </div>

                  <div className='flex flex-wrap md:flex-nowrap w-full gap-4'>
                    <div className='w-full md:w-1/3'>
                      <Select
                        size='sm'
                        label="Model"
                        placeholder={
                          chatGPTStatus?.connected
                            ? "Select ChatGPT model"
                            : "Connect ChatGPT first"
                        }
                        selectedKeys={model ? new Set([model]) : new Set()}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys)[0]

                          if (selected) {
                            setModelValue(String(selected))
                          }
                        }}
                        isDisabled={
                          !chatGPTStatus?.connected ||
                          chatGPTModels.length === 0
                        }
                      >
                        {chatGPTModels.map((item) => (
                          <SelectItem key={item.slug} value={item.slug}>
                            {item.displayName}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>

                    <div className='w-full md:w-1/3'>
                      <Slider
                        label="Batch Sizes"
                        size="md"
                        step={10}
                        maxValue={200}
                        minValue={10}
                        value={batchSizes}
                        onChange={(e) =>
                          typeof e === "number"
                            ? setBatchSizes([e])
                            : setBatchSizes(e)
                        }
                      />
                    </div>

                    <div className='w-full md:w-1/3'>
                      <Input
                        size='sm'
                        type="number"
                        min="1"
                        max="500"
                        label="Rate Limit"
                        value={rateLimit.toString()}
                        onValueChange={(value) => setRateLimitValue(value)}
                        autoComplete='on'
                        endContent={
                          <div className="pointer-events-none flex items-center">
                            <span className="text-default-400 text-small">
                              RPM
                            </span>
                          </div>
                        }
                      />
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </form>

        <div className='w-full justify-between md:justify-center flex flex-wrap gap-1 sm:gap-4 mt-auto sticky top-0 backdrop-blur px-4 pt-4'>
          <FileUploadButton
            label={"Import SRT"}
            onFileSelect={async (file) => {
              try {
                const text = await file.text()
                const parsed = subtitleParser.fromSrt(text)

                setInputFileName(file.name || "subtitle.srt")
                setSrtInputText(text)
                setSrtOutputText(text)
                setInputs(parsed.map(x => x.text))
                setOutput([])
                setUsageInformation(null)
              }
              catch (error) {
                alert(error?.message ?? error)
              }
            }}
          />

          {!translatorRunningState && (
            <Button
              type='submit'
              form="translator-config-form"
              color="primary"
              isDisabled={
                !chatGPTStatus?.connected ||
                !model ||
                inputs.length === 0
              }
            >
              Start
            </Button>
          )}

          {translatorRunningState && (
            <Button
              color="danger"
              onClick={stopGeneration}
            >
              Stop
            </Button>
          )}

          <Button
            color="primary"
            onClick={exportSrtFile}
          >
            Export SRT
          </Button>

          <Divider className='mt-3 sm:mt-0' />
        </div>

        <div className="lg:flex lg:gap-4 px-4 mt-4">
          <div className="lg:w-1/2">
            <SubtitleCard label={"Input"}>
              <ol className="py-2 list-decimal line-marker">
                {inputs.map((line, i) => (
                  <li key={i}>
                    <div className='ml-4 truncate'>
                      {line}
                    </div>
                  </li>
                ))}
              </ol>
            </SubtitleCard>
          </div>

          <div className="lg:w-1/2">
            <SubtitleCard label={"Output"}>
              <ol className="py-2 list-decimal line-marker">
                {outputs.map((line, i) => (
                  <li key={i}>
                    <div className='ml-4 truncate'>
                      {line}
                    </div>
                  </li>
                ))}

                {streamOutput && (
                  <pre className='px-2 text-wrap'>
                    {streamOutput}
                  </pre>
                )}
              </ol>
            </SubtitleCard>

            {usageInformation && (
              <Card shadow="sm" className='mt-4 p-4'>
                <span>
                  <b>Estimated Usage (this translation)</b>
                </span>

                <span>
                  Tokens: {usageInformation?.promptTokensUsed} +{" "}
                  {usageInformation?.completionTokensUsed} ={" "}
                  {usageInformation?.usedTokens}
                </span>

                {usageInformation?.wastedTokens > 0 && (
                  <span className='text-danger'>
                    Wasted: {usageInformation?.promptTokensWasted} +{" "}
                    {usageInformation?.completionTokensWasted} ={" "}
                    {usageInformation?.wastedTokens}{" "}
                    {usageInformation?.wastedPercent}
                  </span>
                )}

                {usageInformation?.cachedTokens > 0 && (
                  <span className='text-success'>
                    Cached: {usageInformation?.cachedTokens}
                  </span>
                )}

                {usageInformation?.contextTokens > 0 && (
                  <span>
                    Context: {usageInformation?.contextPromptTokens} +{" "}
                    {usageInformation?.contextCompletionTokens} ={" "}
                    {usageInformation?.contextTokens}
                  </span>
                )}

                <span>
                  {usageInformation?.promptRate} +{" "}
                  {usageInformation?.completionRate} ={" "}
                  {usageInformation?.rate} TPM {RPMInfomation} RPM
                </span>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
