#!/usr/bin/env node

const { program } = require("commander")
const glob = require("glob")
const cheerio = require("cheerio")
const fs = require("fs")
const crypto = require("crypto")
const util = require("util")
const exec = util.promisify(require("child_process").exec)

program
  .version('0.1.0')
  .description('Injects critical CSS, nonces and Subresource integrity checks')
  .requiredOption('-C, --chdir <path>', 'change the working directory')
  .requiredOption('-n, --nonce-placeholder', 'a nonce placeholder for search/replace in server')

program.parse(process.argv)

process.chdir(program.chdir)
const nonce = program.nonce || "DhcnhD3khTMePgXw"

console.info("Starting critical CSS renderer...")

glob("**/*.html", async (er, files) => {
  if (er) console.error(er)

  files.map(async (file) => {
    try {
      const html = fs.readFileSync(file)
      const $ = cheerio.load(html)

      $("head style").after(`<script nonce="${nonce}">window.__webpack_nonce__ = '${nonce}'</script>`);

      $("style, script").each((_, elm) => {
        $(elm).attr("nonce", nonce)
      })

      const promises = []
      const styles = {}

      $("style[href]").each((_, elm) => {
        const promise = hash($(elm).attr('href').substr(1), "sha256")
        .then(value => $(elm).attr("integrity", `sha256-${value}`))
        $(elm).attr("crossorigin", $(elm).attr("crossorigin") || "anonymous")

        promises.push(promise)
      })

      $("[style]").each((_, elm) => {
        const style = $(elm).attr("style")
        const className = computeHash(style).replace(/[\/\+\-\_\=]/g, '').substr(0,8)
        styles[className] = style
        $(elm).addClass(className)
        $(elm).removeAttr("style")
      })

      $("script[src]").each((_, elm) => {
        const promise = hash($(elm).attr('src').substr(1), "sha256")
        .then(value => $(elm).attr("integrity", `sha256-${value}`))
        $(elm).attr("crossorigin", $(elm).attr("crossorigin") || "anonymous")

        promises.push(promise)
      })

      $("link[rel=preload]").each((_, elm) => {
        const $elm = $(elm)

        const onload = $elm.attr("onload")
        const scriptedElm = createElement("link", {
          rel: "preload",
          as: $elm.attr("as"),
          href: $elm.attr("href"),
          type: $elm.attr("type"),
          crossorigin: $elm.attr("crossorigin") || "anonymous",
        }, {
          onload: onload ? `function(){${onload}}` : undefined
        })

        $elm.replaceWith(scriptedElm)
      })

      await Promise.all(promises)

      const styleElm = [`<style nonce="${nonce}">`]
      Object.keys(styles).forEach(style => {
        styleElm.push(`.${style}{${styles[style]}}`)
      })
      styleElm.push(`</style>`)

      $("body").append(styleElm.join(""))

      fs.writeFileSync(`${file}`, $.html())
      console.info("Writing", file)

    } catch (e) {
      if (e.code === "EISDIR") return
      else throw e
    }
  })
})

function computeHash(stringHtml) {
  return crypto.createHash("sha256").update(stringHtml).digest("base64")
}

const createElement = (tag, attrs = {}, events = {}) => {
  const elm = [`<script nonce="${nonce}">!function(){var e=document.createElement("${tag}")`]

  Object.keys(attrs).forEach(attr => {
    if (attrs[attr]) elm.push(`e.${attr}="${attrs[attr]}"`)
  })

  Object.keys(events).forEach(attr => {
    if (events[attr]) elm.push(`e.${attr}=${events[attr]}`)
  })

  elm.push(`document.head.appendChild(e);}()</script>`)
  return elm.join(";")
}

const hash = async (file, algo = "sha256") => {
  const { stdout, stderr } = await exec(`openssl dgst -${algo} -binary ${file} | openssl base64 -A`)
  if (stderr) throw stderr
  return stdout
}
