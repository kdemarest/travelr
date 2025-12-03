// /addcountry command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { AddCountryCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";
import { findIsoCodes } from "./iso-codes.js";
import { getExchangeRateFromCatalog } from "./exchange.js";


function cmdAddcountry()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    const args = command.args;
    const countryName = args.countryName ?? args.country ?? args.name;
    if (!countryName) {
      return; // Parser will throw appropriate error
    }

    const normalizedCountry = countryName.trim();
    const countryAlpha2 = (args.countryAlpha2 ?? args.isoCountry ?? args.code)?.trim();
    const currencyAlpha3 = (args.currencyAlpha3 ?? args.isoCurrency ?? args.currency)?.trim();

    const needsIsoLookup = !countryAlpha2 || !currencyAlpha3;
    const lookupResult = needsIsoLookup ? findIsoCodes(normalizedCountry) : null;

    if (needsIsoLookup && !lookupResult) {
      throw new CommandError(
        `Unable to resolve ISO codes for "${normalizedCountry}". Try a different spelling or specify a well-known alternate name.`
      );
    }

    const resolvedCountryAlpha2 = (countryAlpha2 ?? lookupResult?.countryAlpha2 ?? "").trim().toUpperCase();
    const resolvedCurrencyAlpha3 = (currencyAlpha3 ?? lookupResult?.currencyAlpha3 ?? "").trim().toUpperCase();

    if (!resolvedCountryAlpha2 || !resolvedCurrencyAlpha3) {
      throw new CommandError(
        `Unable to resolve ISO codes for "${normalizedCountry}". Try a different spelling or specify a well-known alternate name.`
      );
    }

    // Look up exchange rate from catalog (sync - catalog refreshed at startup)
    const existingRate = args.exchangeRateToUSD ?? args.rate ?? args.fx ?? args.exchangeRate;
    let resolvedExchangeRate = existingRate ? Number(existingRate) : undefined;
    let resolvedRateTimestamp = (args.exchangeRateLastUpdate ?? args.rateDate ?? args.rateTimestamp ?? "").trim();

    const catalogRecord = getExchangeRateFromCatalog(resolvedCurrencyAlpha3);
    if (catalogRecord && Number.isFinite(catalogRecord.exchangeRateToUSD) && catalogRecord.exchangeRateToUSD > 0) {
      resolvedExchangeRate = catalogRecord.exchangeRateToUSD;
      resolvedRateTimestamp = catalogRecord.exchangeRateLastUpdate ?? resolvedRateTimestamp;
    }

    if (!resolvedExchangeRate || !Number.isFinite(resolvedExchangeRate) || resolvedExchangeRate <= 0) {
      resolvedExchangeRate = 1;
    }

    // Mutate args with resolved values
    args.countryName = normalizedCountry;
    args.countryAlpha2 = resolvedCountryAlpha2;
    args.currencyAlpha3 = resolvedCurrencyAlpha3;
    args.exchangeRateToUSD = String(resolvedExchangeRate);
    if (resolvedRateTimestamp) {
      args.exchangeRateLastUpdate = resolvedRateTimestamp;
    }
    if (!args.id) {
      args.id = ctx.generateUid();
    }
    
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleAddcountry(
	command: CommandWithArgs,
	ctx: CommandContext
	): Promise<CommandHandlerResult> {
	return {};
  }

  function parseAddCountry(command: CommandWithArgs): AddCountryCommand {
	const args = command.args;
	const countryName = args.countryName ?? args.country ?? args.name;
	if (!countryName || !countryName.trim()) {
		throw new CommandError("/addcountry requires countryName (positional or countryName=...)");
	}
	const countryAlpha2 = args.countryAlpha2 ?? args.isoCountry ?? args.code;
	const currencyAlpha3 = args.currencyAlpha3 ?? args.isoCurrency ?? args.currency;
	const id = args.id ?? args.countryId;
	const rateRaw = args.exchangeRateToUSD ?? args.rate ?? args.fx ?? args.exchangeRate;
	let exchangeRateToUSD: number | undefined;
	if (rateRaw !== undefined) {
		const parsed = Number(rateRaw);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			throw new CommandError("exchangeRateToUSD must be a positive number.");
		}
		exchangeRateToUSD = parsed;
	}
	const exchangeRateLastUpdate = args.exchangeRateLastUpdate ?? args.rateDate ?? args.rateTimestamp;
	const normalizedRateDate = typeof exchangeRateLastUpdate === "string" ? exchangeRateLastUpdate.trim() : undefined;
	return {
		commandId: "addcountry",
		countryName: countryName.trim(),
		countryAlpha2: countryAlpha2?.trim(),
		currencyAlpha3: currencyAlpha3?.trim(),
		id: id?.trim(),
		exchangeRateToUSD,
		exchangeRateLastUpdate: normalizedRateDate
	};
  }

	return { commandId: "addcountry", positionalKey: "countryName", parser: parseAddCountry, handler: handleAddcountry, enricher: enrich };
}
registerCommand(cmdAddcountry());
