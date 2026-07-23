export const validate = (schema) => {
  return (req, res, next) => {
    try {
      res.locals.validated = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      next();
    } catch (error) {
      // Mirror FastAPI/Pydantic's validation failure exactly: HTTP 422 with a
      // {detail: [{type, loc, msg, input}]} list. The web client parses that
      // array to build its message (LMS-Web/src/services/api.ts) — any other
      // shape leaves the user staring at a bare "HTTP 400".
      const detail = (error.issues ?? []).map((issue) => {
        // Zod reports an absent field as invalid_type/"received undefined";
        // Pydantic calls that "missing" / "Field required".
        const isMissing =
          issue.code === "invalid_type" &&
          (issue.received === "undefined" || /received undefined$/.test(issue.message ?? ""));
        return {
          type: isMissing ? "missing" : issue.code,
          loc: issue.path,
          msg: isMissing ? "Field required" : issue.message,
          input: null,
        };
      });

      return res.status(422).json({ detail });
    }
  };
};
