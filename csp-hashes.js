const critical = require("critical")
const glob = require("glob")
const crypto = require("crypto")
const cheerio = require("cheerio")
const fs = require("fs")
const CspPolicy = require("csp-parse")

process.chdir("./public")

const s3ParamsFile = "../.cache/s3.params.json"
const csp = JSON.parse(fs.readFileSync(s3ParamsFile))

console.info('Starting critical CSS renderer...')

glob("**/*.html", async (er, files) => {
  if (er) console.error(er)

  const hashes = await Promise.all(
    files.map(async (file) => {
      try {
        const html = await critical.generate({
          base: ".",
          src: file,
          width: 1300,
          height: 900,
          inline: true,
          minify: true,
        })

        const $ = cheerio.load(html)

        return {
          html,
          path: file,
          styleHashes: [
            ...$("style")
              .map((_, elm) => {
                return computeHash($(elm)[0].children[0].data)
              })
              .get(),

            ...$("[style]")
              .map((_, elm) => {
                return computeHash($(elm).attr("style"))
              })
              .get(),
          ]
            .filter((e) => e !== undefined)
            .filter(unique),
          scriptHashes: $("script")
            .map((_, elm) => {
              if ($(elm)[0].children.length > 0) {
                return computeHash($(elm)[0].children[0].data)
              }
            })
            .get()
            .filter((e) => e !== undefined)
            .filter(unique),
        }
      } catch (e) {
        if (e.code === "EISDIR") return
        else throw e
      }
    })
  )

  hashes
    .filter((e) => e !== undefined)
    .forEach(({ html, path, scriptHashes, styleHashes }) => {
      const headers = csp[path].Metadata

      Object.keys(headers)
        .filter((header) =>
          [
            "Content-Security-Policy-Report-Only",
            "Content-Security-Policy",
          ].includes(header)
        )
        .forEach((header) => {
          const struct = new CspPolicy(headers[header])

          //styleHashes.forEach(hash => struct.add('style-src', hash))
          scriptHashes.forEach(hash => struct.add('script-src', hash))

          csp[path].Metadata[header] = struct.toString()
        })

      fs.writeFileSync(`${path}`, html)
      console.info('Replaced HTML file', path)
    })

  fs.writeFileSync(`${s3ParamsFile}`, JSON.stringify(csp))
  console.info('Updated CSP headers.')
})

function computeHash(stringHtml) {
  const hash = crypto.createHash("sha256").update(stringHtml).digest("base64")
  return "'sha256-" + hash + "'"
}

function unique(value, index, self) {
  return self.indexOf(value) === index
}
